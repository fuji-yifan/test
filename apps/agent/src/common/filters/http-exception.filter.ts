import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common'
import { randomUUID } from 'crypto'

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name)

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp()
    const response = ctx.getResponse()
    const requestId = randomUUID()

    let status = HttpStatus.INTERNAL_SERVER_ERROR
    let message = 'Internal server error'

    if (exception instanceof HttpException) {
      status = exception.getStatus()
      const exResponse = exception.getResponse()
      message =
        typeof exResponse === 'string'
          ? exResponse
          : (exResponse as any).message || exception.message
    } else if (exception instanceof Error) {
      message = exception.message
      this.logger.error(`Unhandled error: ${exception.message}`, exception.stack)
    }

    response.status(status).json({
      code: status * 100,
      data: null,
      message: Array.isArray(message) ? message.join('; ') : message,
      requestId,
    })
  }
}
