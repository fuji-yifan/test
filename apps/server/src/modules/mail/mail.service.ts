import { Injectable, Logger } from '@nestjs/common'
import * as nodemailer from 'nodemailer'

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name)
  private transporter: nodemailer.Transporter | null = null

  constructor() {
    const host = process.env.MAIL_HOST
    const user = process.env.MAIL_USER

    if (host && user) {
      this.transporter = nodemailer.createTransport({
        host,
        port: Number(process.env.MAIL_PORT) || 587,
        secure: process.env.MAIL_SECURE === 'true',
        auth: {
          user,
          pass: process.env.MAIL_PASS || '',
        },
      })
    } else {
      this.logger.warn('MAIL_HOST/MAIL_USER not configured — email sending disabled')
    }
  }

  async send(to: string, subject: string, html: string): Promise<boolean> {
    if (!this.transporter) {
      this.logger.warn(`Email to ${to} skipped: no SMTP config`)
      return false
    }

    try {
      await this.transporter.sendMail({
        from: process.env.MAIL_FROM || process.env.MAIL_USER,
        to,
        subject,
        html,
      })
      this.logger.log(`Email sent to ${to}: ${subject}`)
      return true
    } catch (err) {
      this.logger.error(`Email failed to ${to}: ${err}`)
      return false
    }
  }
}
