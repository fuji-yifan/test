import { Injectable, NotFoundException, Logger } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import { WorkflowService } from '../workflow/workflow.service'

@Injectable()
export class SubmissionService {
  private readonly logger = new Logger(SubmissionService.name)

  constructor(
    private prisma: PrismaClient,
    private workflowService: WorkflowService,
  ) {}

  async submit(formId: string, dto: { data: Record<string, any>; meta?: any }, userId?: string) {
    const form = await this.prisma.form.findUnique({ where: { id: formId } })
    if (!form || form.deletedAt || form.status !== 'published') {
      throw new NotFoundException('表单不存在或未发布')
    }

    const submission = await this.prisma.formSubmission.create({
      data: {
        formId,
        formVersion: form.publishedVersion,
        data: dto.data,
        meta: dto.meta || {},
        submitterId: userId || null,
      },
    })

    // 自动触发绑定到此表单的已发布工作流
    this.triggerWorkflows(formId, submission.id, dto.data, userId).catch((err) => {
      this.logger.error(`触发工作流失败 formId=${formId} subId=${submission.id}`, err)
    })

    return submission
  }

  /**
   * 查找所有绑定了此表单的工作流并启动流程实例
   */
  private async triggerWorkflows(
    formId: string,
    submissionId: string,
    formData: Record<string, any>,
    userId?: string,
  ) {
    // 查询所有已发布的流程定义
    const definitions = await this.prisma.processDefinition.findMany({
      where: { workspaceId: (await this.getFormWorkspace(formId)), status: 'published' },
    })

    for (const def of definitions) {
      const nodes = (def.nodes as any[]) || []
      const startNode = nodes.find((n: any) => n.type === 'start')
      // 开始节点绑定了此表单才触发
      if (startNode?.config?.formId === formId) {
        try {
          await this.workflowService.startProcess(
            def.id,
            userId || 'anonymous',
            formId,
            submissionId,
            formData,
          )
          this.logger.log(`工作流已发起 defId=${def.id} formId=${formId}`)
        } catch (err: any) {
          this.logger.error(`发起流程失败 defId=${def.id}`, err)
        }
      }
    }
  }

  private async getFormWorkspace(formId: string): Promise<string> {
    const form = await this.prisma.form.findUnique({ where: { id: formId }, select: { workspaceId: true } })
    return form?.workspaceId || ''
  }

  async list(formId: string, query: { page?: number; pageSize?: number }) {
    const page = Number(query.page) || 1
    const pageSize = Number(query.pageSize) || 20

    const [list, total] = await Promise.all([
      this.prisma.formSubmission.findMany({
        where: { formId },
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          formId: true,
          formVersion: true,
          status: true,
          submitterId: true,
          createdAt: true,
          submitter: {
            select: { id: true, nickname: true, email: true },
          },
        },
      }),
      this.prisma.formSubmission.count({ where: { formId } }),
    ])

    return {
      list,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    }
  }

  async getById(formId: string, id: string) {
    const submission = await this.prisma.formSubmission.findFirst({
      where: { id, formId },
      include: {
        submitter: { select: { id: true, nickname: true, email: true } },
      },
    })
    if (!submission) throw new NotFoundException('提交数据不存在')
    return submission
  }

  async deleteSubmission(id: string) {
    return this.prisma.formSubmission.delete({ where: { id } })
  }

  async updateStatus(id: string, status: string) {
    return this.prisma.formSubmission.update({
      where: { id },
      data: { status },
    })
  }
}
