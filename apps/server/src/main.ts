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

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule)

  // 调大 body parser 上限，省市区模板数据较大
  app.useBodyParser('json', { limit: '10mb' })
  const logger = new Logger('Bootstrap')

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

  const port = process.env.PORT || 3000
  await app.listen(port)
  logger.log(`Server running on http://localhost:${port}`)
  logger.log(`API docs: http://localhost:${port}/api/docs`)
}
bootstrap()
