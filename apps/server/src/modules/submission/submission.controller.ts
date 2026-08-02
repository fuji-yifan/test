import { Controller, Get, Post, Patch, Delete, Body, Param, Query, Req, Res, UseGuards, UseInterceptors } from '@nestjs/common'
import { Response } from 'express'
import { JwtService } from '@nestjs/jwt'
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger'
import { SubmissionService } from './submission.service'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { PermissionGuard, RequiredPermission } from '../../common/guards/permission.guard'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Public } from '../../common/decorators/public.decorator'
import { FieldACLInterceptor } from '../../common/interceptors/field-acl.interceptor'
import { RowLevelInterceptor } from '../../common/interceptors/row-level.interceptor'
import { getRequestContext } from '../../common/request-context'

@ApiTags('Submissions')
@Controller()
export class SubmissionController {
  constructor(
    private submissionService: SubmissionService,
    private jwtService: JwtService,
  ) {}

  @Public()
  @Post('public/forms/:formId/submit')
  submitPublic(
    @Param('formId') formId: string,
    @Body() dto: { data: Record<string, any>; meta?: any },
    @Req() req?: Request,
  ) {
    // 从 Authorization header 中提取用户身份（可选，未登录也可提交）
    let userId: string | undefined
    try {
      const authHeader = (req?.headers as any)?.['authorization']
      if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.slice(7)
        const payload = this.jwtService.verify(token)
        userId = payload?.sub
      }
    } catch { /* token 无效则视为匿名提交 */ }
    // 将已登录用户的 ID 写入审计上下文（公开接口不走 JWT Guard）
    if (userId) {
      const ctx = getRequestContext()
      if (ctx) ctx.userId = userId
    }
    return this.submissionService.submit(formId, dto, userId)
  }

  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequiredPermission('submission:edit')
  @UseInterceptors(FieldACLInterceptor)
  @ApiBearerAuth()
  @Post('forms/:formId/submit')
  submitAuth(
    @Param('formId') formId: string,
    @CurrentUser('userId') userId: string,
    @Body() dto: { data: Record<string, any>; meta?: any },
  ) {
    return this.submissionService.submit(formId, dto, userId)
  }

  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequiredPermission('submission:view')
  @UseInterceptors(RowLevelInterceptor)
  @ApiBearerAuth()
  @Get('forms/:formId/submissions')
  list(
    @Param('formId') formId: string,
    @Query() query: { page?: number; pageSize?: number },
  ) {
    return this.submissionService.list(formId, query)
  }

  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequiredPermission('submission:export')
  @ApiBearerAuth()
  @Get('forms/:formId/submissions/export')
  async exportData(
    @Param('formId') formId: string,
    @Query('format') format: 'csv' | 'excel',
    @Res() res: Response,
  ) {
    const result = await this.submissionService.exportSubmissions(formId, format || 'csv')
    res.setHeader('Content-Type', result.contentType)
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(result.filename)}`)
    res.send(result.content)
  }

  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequiredPermission('submission:view')
  @ApiBearerAuth()
  @Get('forms/:formId/submissions/:id')
  getById(@Param('formId') formId: string, @Param('id') id: string) {
    return this.submissionService.getById(formId, id)
  }

  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequiredPermission('submission:edit')
  @ApiBearerAuth()
  @Patch('forms/:formId/submissions/:id')
  updateStatus(
    @Param('id') id: string,
    @Body() dto: { status: string },
  ) {
    return this.submissionService.updateStatus(id, dto.status)
  }

  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequiredPermission('submission:delete')
  @ApiBearerAuth()
  @Delete('forms/:formId/submissions/:id')
  deleteSubmission(@Param('id') id: string) {
    return this.submissionService.deleteSubmission(id)
  }
}
