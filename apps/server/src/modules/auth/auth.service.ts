import { Injectable, UnauthorizedException, ConflictException, BadRequestException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { PrismaClient } from '@prisma/client'
import * as bcrypt from 'bcryptjs'
import { LoginDto, RegisterDto } from './dto/login.dto'

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaClient,
    private jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto) {
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

    await this.ensureWorkspace(user.id, dto.nickname)

    return this.generateToken(user.id, user.email)
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } })
    if (!user) throw new UnauthorizedException('邮箱或密码错误')

    const valid = await bcrypt.compare(dto.password, user.passwordHash)
    if (!valid) throw new UnauthorizedException('邮箱或密码错误')

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    })

    // 兼容旧用户：如果没有工作空间，自动补建
    await this.ensureWorkspace(user.id, user.nickname || user.email.split('@')[0])

    return this.generateToken(user.id, user.email)
  }

  /** 确保用户至少有一个工作空间，没有则自动创建 */
  private async ensureWorkspace(userId: string, nickname: string) {
    const count = await this.prisma.workspaceMember.count({ where: { userId } })
    if (count > 0) return

    const slug = `ws_${userId.substring(0, 8)}`
    await this.prisma.workspace.create({
      data: {
        name: `${nickname} 的工作空间`,
        slug,
        members: { create: { userId, role: 'owner' } },
      },
    })
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

  private generateToken(userId: string, email: string) {
    const payload = { sub: userId, email }
    return {
      accessToken: this.jwtService.sign(payload),
      user: { id: userId, email },
    }
  }
}
