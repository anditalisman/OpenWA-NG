import { randomBytes, createHash } from 'crypto';
import { GoneException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SelfServiceKeyRequest } from './entities/self-service-key-request.entity';
import { AuthService } from './auth.service';
import { ApiKeyRole, type ApiKey } from './entities/api-key.entity';
import { MailService } from '../../common/mail/mail.service';
import { createLogger } from '../../common/services/logger.service';

const TOKEN_BYTES = 32;
const DEFAULT_TOKEN_TTL_MINUTES = 30;

@Injectable()
export class SelfServiceApiKeyService {
  private readonly logger = createLogger('SelfServiceApiKeyService');

  constructor(
    @InjectRepository(SelfServiceKeyRequest, 'main')
    private readonly requestRepository: Repository<SelfServiceKeyRequest>,
    private readonly authService: AuthService,
    private readonly mailService: MailService,
  ) {}

  isEnabled(): boolean {
    return process.env.SELF_SERVICE_API_KEYS_ENABLED === 'true';
  }

  private allowedDomains(): string[] {
    return (process.env.SELF_SERVICE_ALLOWED_EMAIL_DOMAINS || '')
      .split(',')
      .map(d => d.trim().toLowerCase())
      .filter(Boolean);
  }

  private isAllowedEmail(email: string): boolean {
    const domain = email.split('@')[1]?.toLowerCase();
    return !!domain && this.allowedDomains().includes(domain);
  }

  private tokenTtlMinutes(): number {
    const parsed = parseInt(process.env.SELF_SERVICE_TOKEN_TTL_MINUTES || '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TOKEN_TTL_MINUTES;
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * Accepts a self-service request. Deliberately returns the same thing (nothing — the caller
   * always responds `{ submitted: true }`) whether the email domain is allow-listed or not, and
   * whether or not the send actually happened, so this endpoint cannot be used to enumerate which
   * domains are configured or which addresses already have a pending request. A non-allow-listed
   * domain is logged server-side and silently drops the request.
   */
  async requestKey(dto: { name: string; email: string }, ip?: string): Promise<void> {
    if (!this.isEnabled()) {
      throw new ServiceUnavailableException('Self-service API key requests are not enabled');
    }

    const email = dto.email.trim().toLowerCase();

    if (!this.isAllowedEmail(email)) {
      this.logger.warn('Self-service key request from a non-allow-listed email domain', { email });
      return;
    }

    const token = randomBytes(TOKEN_BYTES).toString('hex');
    const request = this.requestRepository.create({
      name: dto.name,
      email,
      tokenHash: this.hashToken(token),
      expiresAt: new Date(Date.now() + this.tokenTtlMinutes() * 60_000),
      createdIp: ip ?? null,
    });
    await this.requestRepository.save(request);

    const dashboardUrl = (process.env.DASHBOARD_URL || process.env.BASE_URL || '').replace(/\/+$/, '');
    const verifyUrl = `${dashboardUrl}/verify-api-key?token=${token}`;
    const ttl = this.tokenTtlMinutes();

    try {
      await this.mailService.send({
        to: email,
        subject: 'Verifikasi permintaan API key OpenWA PAMGM',
        text:
          `Halo ${dto.name},\n\n` +
          `Klik link berikut untuk memverifikasi email Anda dan menerima API key ` +
          `(berlaku ${ttl} menit, hanya bisa dipakai sekali):\n\n${verifyUrl}\n\n` +
          `Kalau Anda tidak meminta ini, abaikan email ini.`,
        html:
          `<p>Halo ${dto.name},</p>` +
          `<p>Klik link berikut untuk memverifikasi email Anda dan menerima API key ` +
          `(berlaku ${ttl} menit, hanya bisa dipakai sekali):</p>` +
          `<p><a href="${verifyUrl}">${verifyUrl}</a></p>` +
          `<p>Kalau Anda tidak meminta ini, abaikan email ini.</p>`,
      });
    } catch (error) {
      // The token is only useful once it's delivered — drop the request rather than leave an
      // orphaned row the caller has no way to redeem, and let them retry cleanly.
      await this.requestRepository.delete(request.id);
      this.logger.error(
        'Failed to send self-service verification email',
        error instanceof Error ? error.stack : String(error),
        { requestId: request.id, email },
      );
      throw new ServiceUnavailableException('Could not send the verification email right now — please try again later');
    }

    this.logger.log('Self-service verification email sent', { requestId: request.id, email });
  }

  /**
   * Consumes a single-use token and issues a real ApiKey: role OPERATOR, allowedSessions left
   * unset so AuthService's effective-scope resolution defaults it to "sessions this key creates
   * itself" — the same safe default an admin-created unscoped operator key gets.
   */
  async verifyAndIssue(token: string): Promise<{ apiKey: ApiKey; rawKey: string; request: SelfServiceKeyRequest }> {
    if (!this.isEnabled()) {
      throw new ServiceUnavailableException('Self-service API key requests are not enabled');
    }

    const tokenHash = this.hashToken(token);
    const request = await this.requestRepository.findOne({ where: { tokenHash } });
    if (!request) {
      throw new NotFoundException('Invalid or unknown verification link');
    }
    if (request.consumedAt) {
      throw new GoneException('This verification link has already been used');
    }
    if (request.expiresAt.getTime() < Date.now()) {
      throw new GoneException('This verification link has expired — submit a new request');
    }

    const { apiKey, rawKey } = await this.authService.createApiKey({
      name: request.name,
      role: ApiKeyRole.OPERATOR,
    });

    request.consumedAt = new Date();
    await this.requestRepository.save(request);

    this.logger.log('Self-service API key issued', {
      requestId: request.id,
      keyId: apiKey.id,
      email: request.email,
    });

    return { apiKey, rawKey, request };
  }
}
