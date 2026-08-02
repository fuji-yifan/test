import { Global, Module, OnModuleInit } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import { createAuditMiddleware } from './audit-middleware'

@Global()
@Module({
  providers: [
    {
      provide: PrismaClient,
      useFactory: () => {
        const prisma = new PrismaClient()
        prisma.$use(createAuditMiddleware(prisma))
        return prisma
      },
    },
  ],
  exports: [PrismaClient],
})
export class PrismaModule implements OnModuleInit {
  constructor(private prisma: PrismaClient) {}

  async onModuleInit() {
    await this.prisma.$connect()
  }
}
