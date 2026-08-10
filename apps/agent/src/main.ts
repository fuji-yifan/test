import { NestFactory } from '@nestjs/core'
import { NestExpressApplication } from '@nestjs/platform-express'
import { ValidationPipe } from '@nestjs/common'
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger'
import { AppModule } from './app.module'
import { validateEnv } from './config/env.validation'
import { HttpExceptionFilter } from './common/filters/http-exception.filter'
import { ApiResponseInterceptor } from './common/interceptors/api-response.interceptor'

async function bootstrap(): Promise<void> {
  validateEnv()

  const app = await NestFactory.create<NestExpressApplication>(AppModule)

  // JSON body 限制 10MB（模板数据可能较大）
  app.useBodyParser('json', { limit: '10mb' })

  // 全局前缀
  app.setGlobalPrefix('api/v1')

  // 全局校验管道
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  )

  // 全局异常过滤器
  app.useGlobalFilters(new HttpExceptionFilter())

  // 全局响应拦截器
  app.useGlobalInterceptors(new ApiResponseInterceptor())

  // CORS
  app.enableCors({
    origin: process.env.AGENT_CORS_ORIGIN || 'http://localhost:5173',
    credentials: true,
  })

  // Swagger
  const config = new DocumentBuilder()
    .setTitle('FurmX AI Agent')
    .setDescription('受控多 Agent 图编排系统 API')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build()
  const document = SwaggerModule.createDocument(app, config)
  SwaggerModule.setup('api/docs', app, document)

  const port = process.env.AGENT_PORT || 3002
  await app.listen(port)
  console.log(`[Agent] Running on http://localhost:${port}`)
  console.log(`[Agent] API docs: http://localhost:${port}/api/docs`)
}

bootstrap()
