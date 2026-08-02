declare module 'multer' {
  import type { Request } from 'express'

  interface MulterFile {
    fieldname: string
    originalname: string
    encoding: string
    mimetype: string
    size: number
    destination: string
    filename: string
    path: string
    buffer: Buffer
  }

  interface StorageEngine {
    _handleFile(
      req: Request,
      file: MulterFile,
      cb: (error?: unknown, info?: Partial<MulterFile>) => void,
    ): void
    _removeFile(req: Request, file: MulterFile, cb: (error: Error | null) => void): void
  }

  interface DiskStorageOptions {
    destination?:
      | string
      | ((req: Request, file: MulterFile, cb: (error: Error | null, destination: string) => void) => void)
    filename?: (
      req: Request,
      file: MulterFile,
      cb: (error: Error | null, filename: string) => void,
    ) => void
  }

  export function diskStorage(options: DiskStorageOptions): StorageEngine
  export function memoryStorage(): StorageEngine
}

declare namespace Express {
  namespace Multer {
    interface File {
      fieldname: string
      originalname: string
      encoding: string
      mimetype: string
      size: number
      destination: string
      filename: string
      path: string
      buffer: Buffer
    }
  }
}
