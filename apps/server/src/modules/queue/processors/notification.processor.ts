import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Job } from 'bullmq'
import { MailService } from '../../mail/mail.service'

interface NotificationJob {
  type: string
  userId: string
  title: string
  content: string
  email?: string
  relatedType?: string
  relatedId?: string
}

@Processor('notification')
export class NotificationProcessor extends WorkerHost {
  constructor(private mailService: MailService) {
    super()
  }

  async process(job: Job<NotificationJob>): Promise<{ emailSent: boolean }> {
    const { email, title, content } = job.data
    let emailSent = false

    if (email) {
      emailSent = await this.mailService.send(
        email,
        `[FurmX] ${title}`,
        `<h3>${title}</h3><p>${content}</p><hr/><p style="color:#999">由 FurmX 低代码平台发送</p>`,
      )
    }

    return { emailSent }
  }
}
