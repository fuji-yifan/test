import {
  Controller, Post, UseGuards,
  UseInterceptors, UploadedFile, BadRequestException,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger'
import { diskStorage } from 'multer'
import { mkdirSync } from 'fs'
import { extname, join } from 'path'
import * as crypto from 'crypto'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'

/** 审批签名/附件落盘目录（不依赖 MinIO，随 server 进程本地存储） */
const APPROVAL_UPLOAD_DIR = join(process.cwd(), 'uploads', 'approvals')

/** 审批附件类型白名单：排除 svg/html 等可直接执行脚本的格式 */
const APPROVAL_MIME = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'application/zip', 'application/x-zip-compressed',
])

@ApiTags('Upload')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('upload')
export class UploadController {
  /** 审批签名 / 附件上传（本地磁盘，返回可直接访问的 URL） */
  @Post('approval-file')
  @UseInterceptors(FileInterceptor('file', {
    storage: diskStorage({
      destination: (_req, _file, cb) => {
        mkdirSync(APPROVAL_UPLOAD_DIR, { recursive: true })
        cb(null, APPROVAL_UPLOAD_DIR)
      },
      filename: (_req, file, cb) => {
        const raw = extname(file.originalname).toLowerCase()
        const ext = /^\.[a-z0-9]{1,8}$/.test(raw) ? raw : '.bin'
        cb(null, `${crypto.randomUUID()}${ext}`)
      },
    }),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (!APPROVAL_MIME.has(file.mimetype)) {
        return cb(new BadRequestException('不支持的文件类型'), false)
      }
      cb(null, true)
    },
  }))
  uploadApprovalFile(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('未选择文件')
    // multer 默认按 latin1 解码 originalname，中文文件名需要还原
    const name = Buffer.from(file.originalname, 'latin1').toString('utf8')
    return {
      url: `/uploads/approvals/${file.filename}`,
      name,
      size: file.size,
      mimeType: file.mimetype,
    }
  }
}
