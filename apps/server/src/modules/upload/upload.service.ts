import { Injectable, Inject, BadRequestException } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import * as Minio from 'minio'
import * as crypto from 'crypto'

const AVATAR_MIME = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']

@Injectable()
export class UploadService {
  constructor(
    private prisma: PrismaClient,
    @Inject('MINIO_CLIENT') private minio: Minio.Client,
    @Inject('MINIO_BUCKET') private bucket: string,
  ) {}

  /** 上传头像到 MinIO，返回访问 URL */
  async uploadAvatar(file: Express.Multer.File, userId: string) {
    if (!AVATAR_MIME.includes(file.mimetype)) {
      throw new BadRequestException('仅支持 PNG / JPEG / GIF / WebP 格式')
    }
    const ext = file.originalname.split('.').pop() || 'png'
    const key = `avatars/${userId}-${Date.now()}.${ext}`

    const exists = await this.minio.bucketExists(this.bucket)
    if (!exists) await this.minio.makeBucket(this.bucket)

    await this.minio.putObject(this.bucket, key, file.buffer, file.size, {
      'Content-Type': file.mimetype,
    })

    const endpoint = process.env.MINIO_ENDPOINT || 'localhost'
    const port = process.env.MINIO_PORT || '9000'
    const url = `http://${endpoint}:${port}/${this.bucket}/${key}`

    return { url, key }
  }

  /** 生成 Presigned URL 用于前端直传 */
  async getPresignedUrl(params: {
    fileName: string
    mimeType: string
    workspaceId: string
    userId: string
  }) {
    const ext = params.fileName.split('.').pop() || 'bin'
    const key = `${params.workspaceId}/${Date.now()}-${crypto.randomBytes(8).toString('hex')}.${ext}`

    // 确保 bucket 存在
    const exists = await this.minio.bucketExists(this.bucket)
    if (!exists) await this.minio.makeBucket(this.bucket)

    // 生成 15 分钟有效的 presigned PUT URL
    const presignedUrl = await this.minio.presignedPutObject(this.bucket, key, 900)

    // 构建最终访问 URL
    const endpoint = process.env.MINIO_ENDPOINT || 'localhost'
    const port = process.env.MINIO_PORT || '9000'
    const fileUrl = `http://${endpoint}:${port}/${this.bucket}/${key}`

    return { presignedUrl, key, url: fileUrl }
  }

  /** 客户端上传完成后回调，记录文件元数据 */
  async completeUpload(params: {
    key: string
    fileName: string
    fileSize: number
    mimeType: string
    workspaceId: string
    userId: string
  }) {
    return this.prisma.fileRecord.create({
      data: {
        workspaceId: params.workspaceId,
        userId: params.userId,
        fileName: params.fileName,
        fileSize: params.fileSize,
        mimeType: params.mimeType,
        minioKey: params.key,
        url: `http://${process.env.MINIO_ENDPOINT || 'localhost'}:${process.env.MINIO_PORT || '9000'}/${this.bucket}/${params.key}`,
      },
    })
  }

  /** 获取文件的 Presigned GET URL（用于私有桶临时访问） */
  async getFileUrl(key: string) {
    return this.minio.presignedGetObject(this.bucket, key, 3600)
  }

  async deleteFile(id: string) {
    const record = await this.prisma.fileRecord.findUnique({ where: { id } })
    if (record) {
      await this.minio.removeObject(this.bucket, record.minioKey)
      await this.prisma.fileRecord.delete({ where: { id } })
    }
  }

  async listFiles(workspaceId: string, query: { page?: number; pageSize?: number }) {
    const page = Number(query.page) || 1
    const pageSize = Number(query.pageSize) || 20

    const [list, total] = await Promise.all([
      this.prisma.fileRecord.findMany({
        where: { workspaceId },
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.fileRecord.count({ where: { workspaceId } }),
    ])

    return {
      list,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    }
  }
}
