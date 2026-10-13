import { Injectable } from '@nestjs/common'
import { PassportStrategy } from '@nestjs/passport'
import { ExtractJwt, Strategy } from 'passport-jwt'
import { PrismaClient } from '@prisma/client'
import { getRequestContext } from '../../common/request-context'

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private prisma: PrismaClient) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: process.env.JWT_SECRET || 'dev-secret',
      passReqToCallback: true,
    })
  }

  async validate(req: any, payload: { sub: string; email: string; workspaceId?: string }) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: {
        roles: {
          include: { role: true },
        },
      },
    })
    if (!user || user.status !== 'active') return null

    // 写入审计上下文（workspaceId 来自 JWT 声明，是**可信**来源；不再靠 query/body 补）
    const ctx = getRequestContext()
    if (ctx) {
      ctx.userId = payload.sub
      if (payload.workspaceId) ctx.workspaceId = payload.workspaceId
    }

    // 收集用户角色（含 workspace 维度的 role name）
    const roles: string[] = []
    const userCount = await this.prisma.user.count()
    if (userCount <= 1) {
      roles.push('role:super_admin')
    }
    if (user.roles) {
      for (const ur of user.roles) {
        roles.push(`role:${ur.role.name}`)
      }
    }

    return {
      userId: payload.sub,
      email: payload.email,
      // 身份贯通（阶段 6 / S1.1）：可信工作空间身份，供 request-context / 各服务使用
      workspaceId: payload.workspaceId || null,
      roles,
      deptId: (user as any).deptId || null,
      deptIds: (user as any).deptId ? [(user as any).deptId] : [],
    }
  }
}
