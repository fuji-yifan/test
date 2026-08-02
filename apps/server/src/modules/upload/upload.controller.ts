import {
  Controller, Post, Get, Delete, Body, Param, Query, UseGuards,
  UseInterceptors, UploadedFile,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger'
import { UploadService } from './upload.service'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { PermissionGuard, RequiredPermission } from '../../common/guards/permission.guard'
import { CurrentUser } from '../../common/decorators/current-user.decorator'

@ApiTags('Upload')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('upload')
export class UploadController {
  constructor(private uploadService: UploadService) {}

  /** 获取 Presigned URL 用于直传 MinIO */
  @UseGuards(PermissionGuard)
  @RequiredPermission('upload:manage')
  @Post('presigned-url')
  getPresignedUrl(
    @CurrentUser() user: any,
    @Body() dto: { fileName: string; mimeType: string; workspaceId: string },
  ) {
    return this.uploadService.getPresignedUrl({
      fileName: dto.fileName,
      mimeType: dto.mimeType,
      workspaceId: dto.workspaceId,
      userId: user.userId,
    })
  }

  /** 上传完成后回调记录元数据 */
  @UseGuards(PermissionGuard)
  @RequiredPermission('upload:manage')
  @Post('complete')
  completeUpload(
    @CurrentUser() user: any,
    @Body() dto: {
      key: string; fileName: string; fileSize: number
      mimeType: string; workspaceId: string
    },
  ) {
    return this.uploadService.completeUpload({
      ...dto,
      userId: user.userId,
    })
  }

  /** 上传头像 — 无需工作空间权限 */
  @Post('avatar')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024 } }))
  uploadAvatar(
    @CurrentUser() user: any,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new Error('未选择文件')
    return this.uploadService.uploadAvatar(file, user.userId)
  }

  @UseGuards(PermissionGuard)
  @RequiredPermission('upload:manage')
  @Get('files/:key')
  getFileUrl(@Param('key') key: string) {
    return this.uploadService.getFileUrl(key)
  }

  @UseGuards(PermissionGuard)
  @RequiredPermission('upload:manage')
  @Delete('files/:id')
  deleteFile(@Param('id') id: string) {
    return this.uploadService.deleteFile(id)
  }

  @UseGuards(PermissionGuard)
  @RequiredPermission('upload:manage')
  @Get('files')
  listFiles(
    @Query('workspaceId') workspaceId: string,
    @Query() query: { page?: number; pageSize?: number },
  ) {
    return this.uploadService.listFiles(workspaceId, query)
  }
}
