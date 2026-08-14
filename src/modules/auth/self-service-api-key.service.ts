import { randomBytes, createHash } from 'crypto';
import { GoneException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SelfServiceKeyRequest, SelfServiceRequestPurpose } from './entities/self-service-key-request.entity';
import { AuthService } from './auth.service';
import { ApiKey, ApiKeyRole } from './entities/api-key.entity';
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
    @InjectRepository(ApiKey, 'main')
    private readonly apiKeyRepository: Repository<ApiKey>,
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
   * Shared by requestKey (purpose=ISSUE) and requestRecovery (purpose=RECOVER): create the
   * single-use token row and email it. Deliberately returns the same thing (nothing — the caller
   * always responds `{ submitted: true }`) whether the email domain is allow-listed or not, and
   * whether or not the send actually happened, so the endpoints cannot be used to enumerate which
   * domains are configured or which addresses already have a pending request. A non-allow-listed
   * domain is logged server-side and silently drops the request.
   */
  private async createAndEmailRequest(
    purpose: SelfServiceRequestPurpose,
    dto: { name: string; email: string },
    ip: string | undefined,
    subject: string,
    buildBody: (verifyUrl: string, ttl: number) => { text: string; html: string },
  ): Promise<void> {
    if (!this.isEnabled()) {
      throw new ServiceUnavailableException('Self-service API key requests are not enabled');
    }

    const email = dto.email.trim().toLowerCase();

    if (!this.isAllowedEmail(email)) {
      this.logger.warn('Self-service request from a non-allow-listed email domain', { email, purpose });
      return;
    }

    const token = randomBytes(TOKEN_BYTES).toString('hex');
    const request = this.requestRepository.create({
      purpose,
      name: dto.name,
      email,
      tokenHash: this.hashToken(token),
      expiresAt: new Date(Date.now() + this.tokenTtlMinutes() * 60_000),
      createdIp: ip ?? null,
    });
    await this.requestRepository.save(request);

    const dashboardUrl = (process.env.DASHBOARD_URL || process.env.BASE_URL || '').replace(/\/+$/, '');
    const verifyPath = purpose === SelfServiceRequestPurpose.RECOVER ? 'recover-api-key' : 'verify-api-key';
    const verifyUrl = `${dashboardUrl}/${verifyPath}?token=${token}`;
    const ttl = this.tokenTtlMinutes();
    const { text, html } = buildBody(verifyUrl, ttl);

    try {
      await this.mailService.send({ to: email, subject, text, html });
    } catch (error) {
      // The token is only useful once it's delivered — drop the request rather than leave an
      // orphaned row the caller has no way to redeem, and let them retry cleanly.
      await this.requestRepository.delete(request.id);
      this.logger.error(
        'Failed to send self-service verification email',
        error instanceof Error ? error.stack : String(error),
        { requestId: request.id, email, purpose },
      );
      throw new ServiceUnavailableException('Could not send the verification email right now — please try again later');
    }

    this.logger.log('Self-service verification email sent', { requestId: request.id, email, purpose });
  }

  /** Accepts a request to issue a brand new self-service API key. See createAndEmailRequest. */
  async requestKey(dto: { name: string; email: string }, ip?: string): Promise<void> {
    return this.createAndEmailRequest(
      SelfServiceRequestPurpose.ISSUE,
      dto,
      ip,
      'Verifikasi permintaan API key OpenWA PAMGM',
      (verifyUrl, ttl) => ({
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
      }),
    );
  }

  /**
   * Accepts a "forgot key" recovery request: on verification (verifyAndRecover), every active
   * self-service key already linked to this email is revoked and a replacement is issued — the
   * raw key can never be recovered as-is (only its hash is stored, like a password), so recovery
   * always means reissue, not resend. See createAndEmailRequest.
   */
  async requestRecovery(dto: { name: string; email: string }, ip?: string): Promise<void> {
    return this.createAndEmailRequest(
      SelfServiceRequestPurpose.RECOVER,
      dto,
      ip,
      'Pemulihan API key OpenWA PAMGM',
      (verifyUrl, ttl) => ({
        text:
          `Halo ${dto.name},\n\n` +
          `Anda meminta pemulihan akses API key OpenWA PAMGM untuk email ini. Klik link berikut ` +
          `untuk memverifikasi dan menerima API key baru (berlaku ${ttl} menit, hanya bisa dipakai ` +
          `sekali). API key lama yang terhubung dengan email ini akan langsung dinonaktifkan:\n\n${verifyUrl}\n\n` +
          `Kalau Anda tidak meminta ini, abaikan email ini — API key Anda yang sekarang tetap aktif.`,
        html:
          `<p>Halo ${dto.name},</p>` +
          `<p>Anda meminta pemulihan akses API key OpenWA PAMGM untuk email ini. Klik link berikut ` +
          `untuk memverifikasi dan menerima API key baru (berlaku ${ttl} menit, hanya bisa dipakai ` +
          `sekali). API key lama yang terhubung dengan email ini akan langsung dinonaktifkan:</p>` +
          `<p><a href="${verifyUrl}">${verifyUrl}</a></p>` +
          `<p>Kalau Anda tidak meminta ini, abaikan email ini — API key Anda yang sekarang tetap aktif.</p>`,
      }),
    );
  }

  /** Shared not-found/consumed/expired checks for both verifyAndIssue and verifyAndRecover. */
  private async consumeRequest(
    token: string,
    expectedPurpose: SelfServiceRequestPurpose,
  ): Promise<SelfServiceKeyRequest> {
    if (!this.isEnabled()) {
      throw new ServiceUnavailableException('Self-service API key requests are not enabled');
    }

    const tokenHash = this.hashToken(token);
    const request = await this.requestRepository.findOne({ where: { tokenHash } });
    // A token minted for the other purpose (e.g. a "recover" link replayed at the "issue" verify
    // endpoint) is treated as unknown, not as a wrong-purpose error — same non-enumeration posture
    // as the request endpoints.
    if (!request || request.purpose !== expectedPurpose) {
      throw new NotFoundException('Invalid or unknown verification link');
    }
    if (request.consumedAt) {
      throw new GoneException('This verification link has already been used');
    }
    if (request.expiresAt.getTime() < Date.now()) {
      throw new GoneException('This verification link has expired — submit a new request');
    }
    return request;
  }

  /**
   * Consumes a single-use token and issues a real ApiKey: role OPERATOR, allowedSessions left
   * unset so AuthService's effective-scope resolution defaults it to "sessions this key creates
   * itself" — the same safe default an admin-created unscoped operator key gets.
   */
  async verifyAndIssue(token: string): Promise<{ apiKey: ApiKey; rawKey: string; request: SelfServiceKeyRequest }> {
    const request = await this.consumeRequest(token, SelfServiceRequestPurpose.ISSUE);

    const { apiKey, rawKey } = await this.authService.createApiKey(
      { name: request.name, role: ApiKeyRole.OPERATOR },
      request.email,
    );

    request.consumedAt = new Date();
    await this.requestRepository.save(request);

    this.logger.log('Self-service API key issued', {
      requestId: request.id,
      keyId: apiKey.id,
      email: request.email,
    });

    return { apiKey, rawKey, request };
  }

  /**
   * Consumes a single-use "forgot key" token: issues a fresh OPERATOR key the same way
   * verifyAndIssue does, hands every session ANY key this email has ever owned over to it (see
   * AuthService.reassignSessionOwnership — otherwise a non-admin key's session visibility resolves
   * to "sessions this exact key id created", and a brand-new key id would see none of them), and
   * only then revokes the still-active old key(s).
   *
   * Reassignment deliberately runs over every key ever linked to this email, not just the currently
   * active one(s): if a prior recovery already happened (e.g. before this reassignment logic
   * existed, or a second recovery run back-to-back), the *previous* key is already inactive and
   * would otherwise be silently excluded forever — permanently orphaning whatever sessions it still
   * owns, even though the email is unambiguous proof of ownership. Revoking stays restricted to the
   * active ones: revoke() on an already-inactive key would just be redundant audit noise.
   *
   * Revoking directly via authService.revoke() is safe here without checking the last-usable-admin
   * invariant ourselves — self-service keys are always role OPERATOR (verifyAndIssue never issues
   * ADMIN), so revoke() can never strand the system through this path. Reassign-then-revoke (not the
   * other way around) means a request that fails partway through never leaves a session orphaned
   * under a key that's already gone.
   */
  async verifyAndRecover(
    token: string,
  ): Promise<{ apiKey: ApiKey; rawKey: string; request: SelfServiceKeyRequest; revokedCount: number }> {
    const request = await this.consumeRequest(token, SelfServiceRequestPurpose.RECOVER);

    const allKeysForEmail = await this.apiKeyRepository.find({
      where: { selfServiceEmail: request.email },
    });
    const activeKeys = allKeysForEmail.filter(key => key.isActive);

    const { apiKey, rawKey } = await this.authService.createApiKey(
      { name: request.name, role: ApiKeyRole.OPERATOR },
      request.email,
    );

    for (const key of allKeysForEmail) {
      await this.authService.reassignSessionOwnership(key.id, apiKey.id);
    }
    for (const key of activeKeys) {
      await this.authService.revoke(key.id);
    }

    request.consumedAt = new Date();
    await this.requestRepository.save(request);

    this.logger.log('Self-service API key recovered', {
      requestId: request.id,
      keyId: apiKey.id,
      email: request.email,
      revokedCount: activeKeys.length,
      reassignedFromKeyCount: allKeysForEmail.length,
    });

    return { apiKey, rawKey, request, revokedCount: activeKeys.length };
  }
}
