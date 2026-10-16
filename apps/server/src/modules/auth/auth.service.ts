import { Injectable, Logger, UnauthorizedException, ConflictException, BadRequestException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { PrismaClient } from '@prisma/client'
import * as bcrypt from 'bcryptjs'
import { LoginDto, RegisterDto } from './dto/login.dto'
import { AuditService } from '../audit/audit.service'

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name)

  constructor(
    private prisma: PrismaClient,
    private jwtService: JwtService,
    private audit: AuditService,
  ) {}

  async register(dto: RegisterDto, ip?: string) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } })
    if (existing) throw new ConflictException('该邮箱已被注册')

    const passwordHash = await bcrypt.hash(dto.password, 10)
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash,
        nickname: dto.nickname,
      },
    })

    const workspaceId = await this.ensureWorkspace(user.id, dto.nickname)
    this.writeAudit({
      workspaceId,
      userId: user.id,
      action: 'auth.register',
      resourceType: 'User',
      resourceId: user.id,
      ip,
    })

    return await this.generateToken(user.id, user.email)
  }

  async login(dto: LoginDto, ip?: string) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } })
    if (!user) {
      // 用户不存在 → 无 workspaceId（audit_logs.workspace_id 为 NOT NULL+FK），仅记日志
      this.logger.warn(`登录失败（用户不存在）：${dto.email}`)
      throw new UnauthorizedException('邮箱或密码错误')
    }

    const valid = await bcrypt.compare(dto.password, user.passwordHash)
    if (!valid) {
      const wsId = await this.resolveWorkspaceId(user.id)
      if (wsId) {
        this.writeAudit({
          workspaceId: wsId,
          userId: user.id,
          action: 'auth.login_failed',
          resourceType: 'User',
          resourceId: user.id,
          ip,
          details: { email: dto.email },
        })
      }
      throw new UnauthorizedException('邮箱或密码错误')
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    })

    // 兼容旧用户：如果没有工作空间，自动补建
    const workspaceId = await this.ensureWorkspace(user.id, user.nickname || user.email.split('@')[0])
    this.writeAudit({
      workspaceId,
      userId: user.id,
      action: 'auth.login',
      resourceType: 'User',
      resourceId: user.id,
      ip,
    })

    return await this.generateToken(user.id, user.email)
  }

  /** 取用户最早的工作空间 id（用于审计绑定）；无则 undefined */
  private async resolveWorkspaceId(userId: string): Promise<string | undefined> {
    const member = await this.prisma.workspaceMember.findFirst({
      where: { userId, workspace: { deletedAt: null } },
      orderBy: { createdAt: 'asc' },
      select: { workspaceId: true },
    })
    return member?.workspaceId
  }

  /** 审计写入（fire-and-forget，不阻塞登录/注册主流程；失败仅记日志） */
  private writeAudit(params: {
    workspaceId?: string
    userId?: string
    action: string
    resourceType?: string
    resourceId?: string
    details?: any
    ip?: string
  }) {
    if (!params.workspaceId) return
    const { workspaceId, ...rest } = params
    void this.audit.log({ workspaceId, ...rest }).catch((e) =>
      this.logger.warn(`审计写入失败（${params.action}）：${e?.message ?? e}`),
    )
  }

  /** 确保用户至少有一个**可用**工作空间，没有则自动创建；返回工作空间 id */
  private async ensureWorkspace(userId: string, nickname: string): Promise<string> {
    // deletedAt: null —— 只认存活的空间。否则用户唯一的空间被删后，这里会把墓碑 id
    // 当成「他的工作空间」返回，既写坏审计，又让下面的 generateToken 无路可走。
    const existing = await this.prisma.workspaceMember.findFirst({
      where: { userId, workspace: { deletedAt: null } },
      orderBy: { createdAt: 'asc' },
      select: { workspaceId: true },
    })
    if (existing?.workspaceId) return existing.workspaceId

    const slug = `ws_${userId.substring(0, 8)}`
    const ws = await this.prisma.workspace.create({
      data: {
        name: `${nickname} 的工作空间`,
        slug,
        members: { create: { userId, role: 'owner' } },
        roles: {
          create: [
            { name: '创建者', permissions: ['*'], isSystem: true },
            { name: '查看者', permissions: [], isSystem: true },
          ],
        },
      },
    })
    // 将创建者关联到 RBAC 创建者角色
    const workspaceRoles = await this.prisma.role.findMany({
      where: { workspaceId: ws.id }, select: { id: true, name: true },
    })
    const ownerRole = workspaceRoles.find((r) => r.name === '创建者')
    if (ownerRole) {
      await this.prisma.userRole.create({
        data: { userId, roleId: ownerRole.id },
      })
    }
    return ws.id
  }

  async searchUsers(search: string) {
    return this.prisma.user.findMany({
      where: {
        OR: [
          { email: { contains: search } },
          { nickname: { contains: search } },
        ],
      },
      select: { id: true, email: true, nickname: true, avatarUrl: true },
      take: 20,
    })
  }

  async getUserById(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, nickname: true, avatarUrl: true, status: true, lastLoginAt: true, createdAt: true },
    })
  }

  async updateUser(id: string, data: { nickname?: string; avatarUrl?: string }) {
    const updateData: Record<string, any> = {}
    if (data.nickname !== undefined) updateData.nickname = data.nickname
    if (data.avatarUrl !== undefined) updateData.avatarUrl = data.avatarUrl
    return this.prisma.user.update({
      where: { id },
      data: updateData,
      select: { id: true, email: true, nickname: true, avatarUrl: true, status: true, lastLoginAt: true, createdAt: true },
    })
  }

  async changePassword(userId: string, oldPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } })
    if (!user) throw new BadRequestException('用户不存在')
    const valid = await bcrypt.compare(oldPassword, user.passwordHash)
    if (!valid) throw new BadRequestException('原密码错误')
    const passwordHash = await bcrypt.hash(newPassword, 10)
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } })
  }

  /**
   * 换发 access token，把工作空间身份切到 `workspaceId`。
   *
   * 登录时签进 JWT 的是「最早的工作空间」，之后在 UI 里切空间只改了路由 —— token 里的
   * 声明纹丝不动。而 agent 端取 id 的写法是 `user.workspaceId || context.workspaceId`，
   * JWT 优先，于是切空间对 agent 完全无效：它照旧往旧空间里写（数据写进去用户却看不到）。
   * 调用方需先确认「空间存在、未删除、且用户是成员」（见 WorkspaceGuard）。
   */
  async issueTokenFor(userId: string, workspaceId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    })
    if (!user) throw new UnauthorizedException('用户不存在')
    return this.generateToken(userId, user.email, workspaceId)
  }

  private async generateToken(userId: string, email: string, workspaceId?: string) {
    // 身份贯通（阶段 6 / S1.1）：把 workspaceId 签进 JWT，作为**可信**的工作空间身份来源。
    // 此前 JWT 只有 sub/email，工作空间只能靠前端 context/query 补 —— 那是可伪造的。
    //
    // 默认取用户最早的**存活**成员关系作为「当前工作空间」：墓碑空间（已软删）绝不能
    // 被签进来，否则 agent 每轮都往一个用户永远看不见的空间里写。显式传 workspaceId 时
    // 以此为准（换发路径，已由调用方校验成员关系）。
    const target =
      workspaceId ??
      (
        await this.prisma.workspaceMember.findFirst({
          where: { userId, workspace: { deletedAt: null } },
          orderBy: { createdAt: 'asc' },
          select: { workspaceId: true },
        })
      )?.workspaceId
    const payload = {
      sub: userId,
      email,
      ...(target ? { workspaceId: target } : {}),
    }
    return {
      accessToken: this.jwtService.sign(payload),
      user: { id: userId, email },
    }
  }
}
