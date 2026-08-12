import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { createLogger } from '../services/logger.service';

export interface SendMailOptions {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * Thin nodemailer wrapper, configured entirely from SMTP_* env vars. Lazily creates the transporter
 * on first send (mirrors CacheService's lazy Redis client) so a boot with SMTP unconfigured doesn't
 * fail startup — env.validation.ts already rejects SELF_SERVICE_API_KEYS_ENABLED=true without SMTP
 * configured, so by the time send() is actually called in that flow the vars are guaranteed present;
 * this class stays independently usable (and independently testable) without that guard.
 */
@Injectable()
export class MailService implements OnModuleDestroy {
  private readonly logger = createLogger('MailService');
  private transporter: Transporter | null = null;

  private ensureTransporter(): Transporter {
    if (this.transporter) return this.transporter;

    const host = process.env.SMTP_HOST;
    if (!host) {
      throw new Error('SMTP_HOST is not configured — cannot send email');
    }
    const port = parseInt(process.env.SMTP_PORT || '587', 10);
    // Implicit TLS (SMTPS, typically port 465) vs. STARTTLS (typically port 587) — nodemailer's
    // `secure` flag selects the former; the latter negotiates TLS after a plaintext connect.
    const secure = process.env.SMTP_SECURE === 'true';
    const user = process.env.SMTP_USER;
    const password = process.env.SMTP_PASSWORD;

    this.transporter = createTransport({
      host,
      port,
      secure,
      auth: user ? { user, pass: password } : undefined,
    });
    return this.transporter;
  }

  async send(options: SendMailOptions): Promise<void> {
    const from = process.env.SMTP_FROM;
    if (!from) {
      throw new Error('SMTP_FROM is not configured — cannot send email');
    }
    const transporter = this.ensureTransporter();
    await transporter.sendMail({
      from,
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html,
    });
    this.logger.log('Email sent', { to: options.to, subject: options.subject });
  }

  onModuleDestroy(): void {
    this.transporter?.close();
    this.transporter = null;
  }
}
