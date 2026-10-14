import { NestFactory } from '@nestjs/core'
import { ValidationPipe, Logger } from '@nestjs/common'
import { NestExpressApplication } from '@nestjs/platform-express'
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger'
import { Request } from 'express'
import { join } from 'path'
import { AppModule } from './app.module'
import { HttpExceptionFilter } from './common/filters/http-exception.filter'
import { TransformInterceptor } from './common/interceptors/transform.interceptor'
import { useContextMiddleware } from './common/request-context'
import { AuditContextInterceptor } from './common/interceptors/audit-context.interceptor'
import { CacheService } from './modules/cache/cache.service'

/**
 * JWT 密钥守卫（阶段 6 / S2.4）：
 * - 生产环境：缺失或仍为默认 `dev-secret` → fail-fast，拒绝启动；
 * - 开发环境：缺失或默认 → warn，提示尽快配置。
 * 背景：`auth.module.ts` 的 `JWT_SECRET || 'dev-secret'` 兜底会让生产误用弱密钥签发可伪造令牌。
 */
function assertJwtSecret(logger: Logger) {
  const secret = process.env.JWT_SECRET
  const isDefault = !secret || secret === 'dev-secret'
  if (!isDefault) return
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      '生产环境必须配置强 JWT_SECRET（当前缺失或为默认 dev-secret），已拒绝启动',
    )
  }
  logger.warn('JWT_SECRET 未配置或为默认 dev-secret，仅限开发环境使用')
}

async function bootstrap() {
  const logger = new Logger('Bootstrap')
  assertJwtSecret(logger)

  const app = await NestFactory.create<NestExpressApplication>(AppModule)

  // 调大 body parser 上限，省市区模板数据较大
  app.useBodyParser('json', { limit: '10mb' })

  // 审计上下文中间件 — 提取 userId / workspaceId 绑定到异步上下文
  app.use((req: Request, _res: any, next: () => void) => {
    useContextMiddleware(req, _res, next)
  })

  // 静态文件服务（上传目录）
  app.useStaticAssets(join(process.cwd(), 'uploads'), { prefix: '/uploads' })

  // 全局前缀
  app.setGlobalPrefix('api/v1')

  // 全局验证管道
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  )

  // 全局异常过滤 & 响应包装
  app.useGlobalFilters(new HttpExceptionFilter())
  app.useGlobalInterceptors(
    new AuditContextInterceptor(),
    new TransformInterceptor(),
  )

  // CORS
  app.enableCors({
    origin: process.env.APP_URL || 'http://localhost:5173',
    credentials: true,
  })

  // Swagger API 文档
  const config = new DocumentBuilder()
    .setTitle('FurmX API')
    .setDescription('轻量化低代码表单平台 API 文档')
    .setVersion('1.0')
    .addBearerAuth()
    .build()
  const document = SwaggerModule.createDocument(app, config)
  SwaggerModule.setup('api/docs', app, document)

  // 清除残留的权限缓存
  try {
    const cache = app.get(CacheService)
    await cache.clearAllPermissionCache()
  } catch { /* Redis 不可用时忽略 */ }

  const port = process.env.PORT || 3000
  await app.listen(port)
  logger.log(`Server running on http://localhost:${port}`)
  logger.log(`API docs: http://localhost:${port}/api/docs`)
}
bootstrap()
