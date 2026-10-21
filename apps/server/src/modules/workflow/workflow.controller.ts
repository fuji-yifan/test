import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards,
} from '@nestjs/common'
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger'
import { WorkflowService } from './workflow.service'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { PermissionGuard, RequiredPermission } from '../../common/guards/permission.guard'
import { WorkspaceGuard } from '../../common/guards/workspace.guard'
import { CurrentUser } from '../../common/decorators/current-user.decorator'

@ApiTags('Workflows')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class WorkflowController {
  constructor(private workflowService: WorkflowService) {}

  // ==================== 流程定义 ====================

  @UseGuards(WorkspaceGuard)
  @Get('workspaces/:wsId/workflow-bindings')
  getFormBindings(@Param('wsId') wsId: string) {
    return this.workflowService.getFormBindings(wsId)
  }

  @UseGuards(WorkspaceGuard, PermissionGuard)
  @RequiredPermission('workflow:manage')
  @Get('workspaces/:wsId/workflows')
  listDefinitions(
    @Param('wsId') wsId: string,
    @Query() query: { page?: number; pageSize?: number; status?: string },
  ) {
    return this.workflowService.listDefinitions(wsId, query)
  }

  @UseGuards(WorkspaceGuard, PermissionGuard)
  @RequiredPermission('workflow:manage')
  @Post('workspaces/:wsId/workflows')
  createDefinition(
    @Param('wsId') wsId: string,
    @CurrentUser('userId') userId: string,
    @Body() dto: { name: string; description?: string; nodes?: any; edges?: any },
  ) {
    return this.workflowService.createDefinition(wsId, userId, dto)
  }

  @Get('workflows/:id')
  getDefinition(@Param('id') id: string) {
    return this.workflowService.getDefinition(id)
  }

  @UseGuards(PermissionGuard)
  @RequiredPermission('workflow:edit')
  @Patch('workflows/:id')
  updateDefinition(
    @Param('id') id: string,
    @Body() dto: { name?: string; description?: string; nodes?: any; edges?: any; settings?: any },
  ) {
    return this.workflowService.updateDefinition(id, dto)
  }

  @UseGuards(PermissionGuard)
  @RequiredPermission('workflow:delete')
  @Delete('workflows/:id')
  removeDefinition(@Param('id') id: string) {
    return this.workflowService.removeDefinition(id)
  }

  @UseGuards(PermissionGuard)
  @RequiredPermission('workflow:publish')
  @Post('workflows/:id/publish')
  publishDefinition(@Param('id') id: string) {
    return this.workflowService.publishDefinition(id)
  }

  @UseGuards(PermissionGuard)
  @RequiredPermission('workflow:unpublish')
  @Post('workflows/:id/unpublish')
  unpublishDefinition(@Param('id') id: string) {
    return this.workflowService.unpublishDefinition(id)
  }

  // ==================== 流程实例操作 ====================

  @UseGuards(PermissionGuard)
  @RequiredPermission('task:approve')
  @Post('process-instances/:instanceId/approve')
  approveTask(
    @Param('instanceId') instanceId: string,
    @CurrentUser('userId') userId: string,
    @Body() dto: {
      nodeId: string
      comment?: string
      signature?: string
      attachments?: { name: string; url: string; size?: number; mimeType?: string }[]
    },
  ) {
    return this.workflowService.approveTask(
      instanceId, dto.nodeId, userId, dto.comment, dto.signature, dto.attachments,
    )
  }

  @UseGuards(PermissionGuard)
  @RequiredPermission('task:reject')
  @Post('process-instances/:instanceId/reject')
  rejectTask(
    @Param('instanceId') instanceId: string,
    @CurrentUser('userId') userId: string,
    @Body() dto: {
      nodeId: string
      comment?: string
      targetNodeId?: string
      signature?: string
      attachments?: { name: string; url: string; size?: number; mimeType?: string }[]
    },
  ) {
    return this.workflowService.rejectTask(
      instanceId, dto.nodeId, userId, dto.comment, dto.targetNodeId, dto.signature, dto.attachments,
    )
  }

  // 撤回只认发起人（service 里有归属校验），属于「我的流程」的自助操作，不卡 RBAC
  @Post('process-instances/:instanceId/withdraw')
  withdrawProcess(
    @Param('instanceId') instanceId: string,
    @CurrentUser('userId') userId: string,
  ) {
    return this.workflowService.withdrawProcess(instanceId, userId)
  }

  @UseGuards(PermissionGuard)
  @RequiredPermission('task:transfer')
  @Post('process-instances/:instanceId/transfer')
  transferTask(
    @Param('instanceId') instanceId: string,
    @CurrentUser('userId') userId: string,
    @Body() dto: { nodeId: string; targetUserId: string },
  ) {
    return this.workflowService.transferTask(instanceId, dto.nodeId, userId, dto.targetUserId)
  }

  @UseGuards(PermissionGuard)
  @RequiredPermission('task:transfer')
  @Post('process-instances/:instanceId/add-sign')
  addSign(
    @Param('instanceId') instanceId: string,
    @CurrentUser('userId') userId: string,
    @Body() dto: { nodeId: string; targetUserId: string },
  ) {
    return this.workflowService.addSign(instanceId, dto.nodeId, userId, dto.targetUserId)
  }

  // 删除只认发起人（service 里有归属校验），属于「我的流程」的自助操作，不卡 RBAC
  @Delete('process-instances/:instanceId')
  deleteInstance(
    @Param('instanceId') instanceId: string,
    @CurrentUser('userId') userId: string,
  ) {
    return this.workflowService.deleteInstance(instanceId, userId)
  }

  // ==================== 查询 ====================

  @Get('process-instances/:id')
  getInstance(@Param('id') id: string) {
    return this.workflowService.getInstanceDetail(id)
  }

  // 审批人要看「发起人当时填了什么」才能判断是否通过，所以这条数据的读权限认「发起人本人 / 该实例上有任务的人」
  @Get('process-instances/:instanceId/submission')
  getInstanceSubmission(
    @Param('instanceId') instanceId: string,
    @CurrentUser('userId') userId: string,
  ) {
    return this.workflowService.getInstanceSubmission(instanceId, userId)
  }

  @Get('my-tasks')
  getMyTasks(
    @CurrentUser('userId') userId: string,
    @Query() query: { page?: number; pageSize?: number; status?: string; keyword?: string },
  ) {
    return this.workflowService.getMyTasks(userId, query)
  }

  @Get('my-instances')
  getMyInstances(
    @CurrentUser('userId') userId: string,
    @Query() query: { page?: number; pageSize?: number; status?: string; keyword?: string },
  ) {
    return this.workflowService.getMyInstances(userId, query)
  }
}
