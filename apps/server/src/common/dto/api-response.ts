export class ApiResponse<T = any> {
  code!: number
  data!: T
  message!: string
  requestId!: string

  static success<T>(data: T, message = 'ok'): ApiResponse<T> {
    const res = new ApiResponse<T>()
    res.code = 0
    res.data = data
    res.message = message
    res.requestId = generateRequestId()
    return res
  }

  static error(code: number, message: string): ApiResponse<null> {
    const res = new ApiResponse<null>()
    res.code = code
    res.data = null
    res.message = message
    res.requestId = generateRequestId()
    return res
  }
}

export function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`
}
