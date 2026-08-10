import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common'
import { Observable } from 'rxjs'
import { map } from 'rxjs/operators'
import { randomUUID } from 'crypto'

export interface ApiResponse<T> {
  code: number
  data: T | null
  message: string
  requestId: string
}

@Injectable()
export class ApiResponseInterceptor<T> implements NestInterceptor<T, ApiResponse<T>> {
  intercept(context: ExecutionContext, next: CallHandler): Observable<ApiResponse<T>> {
    const request = context.switchToHttp().getRequest()
    // SSE 请求跳过包装
    const acceptHeader = request.headers?.accept || ''
    if (acceptHeader.includes('text/event-stream')) {
      return next.handle()
    }

    const requestId = randomUUID()

    return next.handle().pipe(
      map((data) => ({
        code: 0,
        data: data ?? null,
        message: 'ok',
        requestId,
      })),
    )
  }
}
