import { ExceptionFilter, Catch, ArgumentsHost, HttpException, Logger } from '@nestjs/common'
import { Response } from 'express'
import { generateRequestId } from '../dto/api-response'

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name)

  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp()
    const response = ctx.getResponse<Response>()
    const status = exception.getStatus()
    const exceptionResponse = exception.getResponse()

    const message =
      typeof exceptionResponse === 'object' && 'message' in exceptionResponse
        ? (exceptionResponse as any).message
        : exception.message

    const requestId = generateRequestId()

    this.logger.warn(`[${requestId}] ${status} ${message}`)

    response.status(status).json({
      code: status * 100,
      data: null,
      message: Array.isArray(message) ? message.join('; ') : message,
      requestId,
    })
  }
}
