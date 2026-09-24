import { randomBytes, createHash } from 'crypto';
import {
  BadRequestException,
  GoneException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, Repository } from 'typeorm';
import { DashboardUser } from './entities/dashboard-user.entity';
import { DashboardLoginSession } from './entities/dashboard-login-session.entity';
import { DashboardPasswordReset } from './entities/dashboard-password-reset.entity';
import { ApiKey, ApiKeyRole } from './entities/api-key.entity';
import { AuthService } from './auth.service';
import { MailService } from '../../common/mail/mail.service';
import { createLogger } from '../../common/services/logger.service';
import {
  burnPasswordCheck,
  hashPassword,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  verifyPassword,
} from './dashboard-password';
import { parseDashboardUsers } from './dashboard-users';

const TOKEN_BYTES = 32;
const DEFAULT_SESSION_TTL_HOURS = 12;
const DEFAULT_RESET_TTL_MINUTES = 30;
const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MINUTES = 15;

@Injectable()
export class DashboardAuthService implements OnModuleInit {
  private readonly logger = createLogger('DashboardAuthService');

  constructor(
    @InjectRepository(DashboardUser, 'main')
    private readonly userRepository: Repository<DashboardUser>,
    @InjectRepository(DashboardLoginSession, 'main')
    private readonly loginSessionRepository: Repository<DashboardLoginSession>,
    @InjectRepository(DashboardPasswordReset, 'main')
    private readonly resetRepository: Repository<DashboardPasswordReset>,
    @InjectRepository(ApiKey, 'main')
    private readonly apiKeyRepository: Repository<ApiKey>,
    private readonly authService: AuthService,
    private readonly mailService: MailService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.syncUsersFromEnv();
  }

  private sessionTtlMs(): number {
    const hours = parseInt(process.env.DASHBOARD_SESSION_TTL_HOURS || '', 10);
    return (Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_SESSION_TTL_HOURS) * 3_600_000;
  }

  private resetTtlMinutes(): number {
    const minutes = parseInt(process.env.DASHBOARD_PASSWORD_RESET_TTL_MINUTES || '', 10);
    return Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_RESET_TTL_MINUTES;
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * Makes the table match DASHBOARD_USERS: listed users are created or updated (role, sessions,
   * active), unlisted ones are deactivated and signed out. Passwords are never taken from the env.
   * An unset/empty variable changes nothing, so a missing env var cannot lock every user out.
   */
  async syncUsersFromEnv(): Promise<void> {
    const specs = parseDashboardUsers(process.env.DASHBOARD_USERS);
    if (specs.length === 0) {
      this.logger.warn('DASHBOARD_USERS is empty — dashboard accounts left unchanged');
      return;
    }

    for (const spec of specs) {
      const existing = await this.userRepository.findOne({ where: { email: spec.email } });
      const user = existing ?? this.userRepository.create({ email: spec.email, passwordHash: null });
      const scopeChanged =
        !!existing &&
        (existing.role !== spec.role ||
          (existing.allowedSessions ?? []).join('|') !== (spec.allowedSessions ?? []).join('|') ||
          !existing.isActive);
      user.role = spec.role;
      user.allowedSessions = spec.allowedSessions;
      user.isActive = true;
      await this.userRepository.save(user);
      // Live logins still carry the old role/sessions on their key; end them so the next login
      // picks up the new scope.
      if (scopeChanged) await this.endAllSessions(user.id);
    }

    const listed = specs.map(s => s.email);
    const stale = (await this.userRepository.find({ where: { isActive: true } })).filter(
      u => !listed.includes(u.email),
    );
    for (const user of stale) {
      user.isActive = false;
      await this.userRepository.save(user);
      await this.endAllSessions(user.id);
    }

    this.logger.log('Dashboard users synced from DASHBOARD_USERS', {
      active: listed.length,
      deactivated: stale.length,
    });
  }

  async login(
    rawEmail: string,
    password: string,
    ip: string | undefined,
  ): Promise<{ apiKey: string; role: ApiKeyRole; email: string; expiresAt: Date; user: DashboardUser }> {
    const email = rawEmail.trim().toLowerCase();
    const user = await this.userRepository.findOne({ where: { email, isActive: true } });

    if (!user || !user.passwordHash) {
      await burnPasswordCheck(password);
      throw new UnauthorizedException('Email atau password salah');
    }
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      throw new UnauthorizedException(
        `Akun dikunci sementara karena terlalu banyak percobaan gagal. Coba lagi setelah ${LOCKOUT_MINUTES} menit.`,
      );
    }

    if (!(await verifyPassword(password, user.passwordHash))) {
      user.failedLoginCount += 1;
      if (user.failedLoginCount >= MAX_FAILED_LOGINS) {
        user.lockedUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60_000);
        user.failedLoginCount = 0;
      }
      await this.userRepository.save(user);
      throw new UnauthorizedException('Email atau password salah');
    }

    await this.purgeExpiredSessions(user.id);

    const expiresAt = new Date(Date.now() + this.sessionTtlMs());
    const { apiKey, rawKey } = await this.authService.createApiKey({
      name: `Dashboard: ${user.email}`,
      role: user.role,
      allowedSessions: user.allowedSessions ?? undefined,
      expiresAt: expiresAt.toISOString(),
    });
    await this.loginSessionRepository.save(
      this.loginSessionRepository.create({ apiKeyId: apiKey.id, userId: user.id, expiresAt, createdIp: ip ?? null }),
    );

    user.failedLoginCount = 0;
    user.lockedUntil = null;
    user.lastLoginAt = new Date();
    await this.userRepository.save(user);

    return { apiKey: rawKey, role: user.role, email: user.email, expiresAt, user };
  }

  /** Ends the login behind this key. A key that is not a dashboard login is left alone. */
  async logout(apiKey: ApiKey): Promise<boolean> {
    const session = await this.loginSessionRepository.findOne({ where: { apiKeyId: apiKey.id } });
    if (!session) return false;
    await this.endSession(session);
    return true;
  }

  /** The dashboard user behind a key, or null when the key was not minted by a dashboard login. */
  async findSessionUser(apiKeyId: string): Promise<DashboardUser | null> {
    const session = await this.loginSessionRepository.findOne({ where: { apiKeyId } });
    if (!session) return null;
    return this.userRepository.findOne({ where: { id: session.userId, isActive: true } });
  }

  /**
   * Emails a single-use link to set or reset the password. Responds identically whether or not the
   * address has an account, so the form cannot be used to discover who does.
   */
  async requestPasswordReset(rawEmail: string, ip: string | undefined): Promise<void> {
    const email = rawEmail.trim().toLowerCase();
    const user = await this.userRepository.findOne({ where: { email, isActive: true } });
    if (!user) {
      this.logger.warn('Password reset requested for an unknown or inactive dashboard email', { email });
      return;
    }

    const token = randomBytes(TOKEN_BYTES).toString('hex');
    const ttl = this.resetTtlMinutes();
    const reset = await this.resetRepository.save(
      this.resetRepository.create({
        userId: user.id,
        tokenHash: this.hashToken(token),
        expiresAt: new Date(Date.now() + ttl * 60_000),
        createdIp: ip ?? null,
      }),
    );

    const dashboardUrl = (process.env.DASHBOARD_URL || process.env.BASE_URL || '').replace(/\/+$/, '');
    const link = `${dashboardUrl}/reset-password?token=${token}`;
    try {
      await this.mailService.send({
        to: email,
        subject: 'Atur password dashboard OpenWA PAMGM',
        text:
          `Halo,\n\nKlik link berikut untuk mengatur password dashboard OpenWA PAMGM ` +
          `(berlaku ${ttl} menit, hanya bisa dipakai sekali):\n\n${link}\n\n` +
          `Kalau Anda tidak meminta ini, abaikan email ini — password Anda tidak berubah.`,
        html:
          `<p>Halo,</p><p>Klik link berikut untuk mengatur password dashboard OpenWA PAMGM ` +
          `(berlaku ${ttl} menit, hanya bisa dipakai sekali):</p>` +
          `<p><a href="${link}">${link}</a></p>` +
          `<p>Kalau Anda tidak meminta ini, abaikan email ini — password Anda tidak berubah.</p>`,
      });
    } catch (error) {
      await this.resetRepository.delete(reset.id);
      this.logger.error(
        'Failed to send dashboard password reset email',
        error instanceof Error ? error.stack : String(error),
        { email },
      );
      throw new ServiceUnavailableException('Email tidak dapat dikirim saat ini — silakan coba lagi nanti');
    }
  }

  /** Consumes a reset link: sets the password, clears any lockout and signs out every open login. */
  async resetPassword(token: string, password: string): Promise<DashboardUser> {
    if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
      throw new BadRequestException(`Password harus ${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} karakter`);
    }

    const reset = await this.resetRepository.findOne({ where: { tokenHash: this.hashToken(token) } });
    if (!reset) throw new NotFoundException('Link tidak valid');
    if (reset.consumedAt) throw new GoneException('Link ini sudah pernah dipakai');
    if (reset.expiresAt.getTime() < Date.now()) throw new GoneException('Link ini sudah kedaluwarsa');

    const user = await this.userRepository.findOne({ where: { id: reset.userId, isActive: true } });
    if (!user) throw new NotFoundException('Link tidak valid');

    user.passwordHash = await hashPassword(password);
    user.failedLoginCount = 0;
    user.lockedUntil = null;
    await this.userRepository.save(user);

    reset.consumedAt = new Date();
    await this.resetRepository.save(reset);

    await this.endAllSessions(user.id);
    return user;
  }

  private async endAllSessions(userId: string): Promise<void> {
    const sessions = await this.loginSessionRepository.find({ where: { userId } });
    for (const session of sessions) await this.endSession(session);
  }

  private async purgeExpiredSessions(userId: string): Promise<void> {
    const expired = await this.loginSessionRepository.find({ where: { userId, expiresAt: LessThan(new Date()) } });
    for (const session of expired) await this.endSession(session);
  }

  /**
   * Deletes the minted key (which also drops its live WebSocket connections) and the marker row.
   *
   * The delete is refused by the last-usable-admin guard when this login's admin key is the only
   * admin key left. That guard exists so API-key admins cannot lock themselves out; with email
   * sign-in any admin in DASHBOARD_USERS can always mint a new admin key, so here the key is expired
   * in place instead, which makes it fail validation immediately without tripping the guard.
   */
  private async endSession(session: DashboardLoginSession): Promise<void> {
    try {
      await this.authService.delete(session.apiKeyId);
    } catch (error) {
      if (!(error instanceof NotFoundException)) {
        await this.apiKeyRepository.update({ id: session.apiKeyId }, { expiresAt: new Date(Date.now() - 1000) });
        this.logger.warn('Dashboard login key could not be deleted, expired it instead', {
          apiKeyId: session.apiKeyId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    await this.loginSessionRepository.delete({ apiKeyId: In([session.apiKeyId]) });
  }
}
