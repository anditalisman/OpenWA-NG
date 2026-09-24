import 'reflect-metadata';
import { DataSource, Repository } from 'typeorm';
import { GoneException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ApiKey, ApiKeyRole } from './entities/api-key.entity';
import { DashboardUser } from './entities/dashboard-user.entity';
import { DashboardLoginSession } from './entities/dashboard-login-session.entity';
import { DashboardPasswordReset } from './entities/dashboard-password-reset.entity';
import { AuthService } from './auth.service';
import { ApiKeyUsageTracker } from './api-key-usage-tracker.service';
import { DashboardAuthService } from './dashboard-auth.service';
import { parseDashboardUsers } from './dashboard-users';
import { hashPassword } from './dashboard-password';
import type { MailService } from '../../common/mail/mail.service';

const AMGM_BOT = '4c18a72f-02c5-40e2-9d28-8e1edac14ef7';

describe('parseDashboardUsers', () => {
  it('parses email, role and an optional |-separated session list', () => {
    expect(
      parseDashboardUsers(` Hary@PTAMGIRIMENANG.com:admin , miracle@ptamgirimenang.com:operator:${AMGM_BOT}|s2 `),
    ).toEqual([
      { email: 'hary@ptamgirimenang.com', role: ApiKeyRole.ADMIN, allowedSessions: null },
      { email: 'miracle@ptamgirimenang.com', role: ApiKeyRole.OPERATOR, allowedSessions: [AMGM_BOT, 's2'] },
    ]);
  });

  it('treats an unset or empty variable as no users', () => {
    expect(parseDashboardUsers(undefined)).toEqual([]);
    expect(parseDashboardUsers(' , ')).toEqual([]);
  });

  it.each([
    ['not-an-email:admin', /valid email/],
    ['a@b.com:owner', /role must be one of/],
    ['a@b.com:admin,A@b.com:viewer', /more than once/],
  ])('rejects %s', (raw, message) => {
    expect(() => parseDashboardUsers(raw)).toThrow(message);
  });
});

describe('DashboardAuthService', () => {
  let ds: DataSource;
  let keys: Repository<ApiKey>;
  let users: Repository<DashboardUser>;
  let loginSessions: Repository<DashboardLoginSession>;
  let resets: Repository<DashboardPasswordReset>;
  let mail: { send: jest.Mock<Promise<void>, [{ to: string; text: string }]> };
  let service: DashboardAuthService;
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    ds = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [ApiKey, DashboardUser, DashboardLoginSession, DashboardPasswordReset],
      synchronize: true,
    });
    await ds.initialize();
    keys = ds.getRepository(ApiKey);
    users = ds.getRepository(DashboardUser);
    loginSessions = ds.getRepository(DashboardLoginSession);
    resets = ds.getRepository(DashboardPasswordReset);

    const tracker = { record: jest.fn(), forget: jest.fn() } as unknown as ApiKeyUsageTracker;
    const moduleRef = { get: jest.fn(() => undefined) };
    const authService = new AuthService(keys, {} as never, tracker, moduleRef as never);
    mail = { send: jest.fn<Promise<void>, [{ to: string; text: string }]>().mockResolvedValue(undefined) };
    service = new DashboardAuthService(users, loginSessions, resets, keys, authService, mail as unknown as MailService);

    process.env.DASHBOARD_USERS = `hary@ptamgirimenang.com:admin,miracle@ptamgirimenang.com:operator:${AMGM_BOT}`;
    process.env.DASHBOARD_URL = 'https://owa.example.test/';
    await service.syncUsersFromEnv();
  });

  afterEach(async () => {
    process.env = { ...originalEnv };
    await ds.destroy();
  });

  const setPassword = async (email: string, password: string) =>
    users.update({ email }, { passwordHash: await hashPassword(password) });

  const emailedToken = (): string => {
    const text = mail.send.mock.calls.at(-1)?.[0]?.text ?? '';
    return /reset-password\?token=([0-9a-f]+)/.exec(text)![1];
  };

  describe('syncUsersFromEnv', () => {
    it('creates the listed users without a password', async () => {
      const all = await users.find({ order: { email: 'ASC' } });
      expect(all.map(u => [u.email, u.role, u.allowedSessions, u.isActive, u.passwordHash])).toEqual([
        ['hary@ptamgirimenang.com', ApiKeyRole.ADMIN, null, true, null],
        ['miracle@ptamgirimenang.com', ApiKeyRole.OPERATOR, [AMGM_BOT], true, null],
      ]);
    });

    it('deactivates and signs out a user dropped from the list', async () => {
      await setPassword('miracle@ptamgirimenang.com', 'correct horse battery');
      await service.login('miracle@ptamgirimenang.com', 'correct horse battery', undefined);
      const key = await keys.findOneByOrFail({ name: 'Dashboard: miracle@ptamgirimenang.com' });

      process.env.DASHBOARD_USERS = 'hary@ptamgirimenang.com:admin';
      await service.syncUsersFromEnv();

      expect((await users.findOneByOrFail({ email: 'miracle@ptamgirimenang.com' })).isActive).toBe(false);
      expect(await keys.count({ where: { name: 'Dashboard: miracle@ptamgirimenang.com' } })).toBe(0);
      expect(await service.findSessionUser(key.id)).toBeNull();
    });

    it('leaves accounts alone when the variable is empty', async () => {
      process.env.DASHBOARD_USERS = '';
      await service.syncUsersFromEnv();
      expect(await users.count({ where: { isActive: true } })).toBe(2);
    });
  });

  describe('login', () => {
    it('mints a short-lived key carrying the user role and sessions, marked as a dashboard login', async () => {
      await setPassword('miracle@ptamgirimenang.com', 'correct horse battery');
      const result = await service.login(' Miracle@ptamgirimenang.com ', 'correct horse battery', '10.0.0.1');

      expect(result.apiKey).toMatch(/^owa_k1_/);
      expect(result.role).toBe(ApiKeyRole.OPERATOR);
      const key = await keys.findOneByOrFail({ name: 'Dashboard: miracle@ptamgirimenang.com' });
      expect(key.allowedSessions).toEqual([AMGM_BOT]);
      expect(key.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 11 * 3_600_000);
      expect((await service.findSessionUser(key.id))?.email).toBe('miracle@ptamgirimenang.com');
    });

    it('refuses a user who has not set a password yet', async () => {
      await expect(service.login('hary@ptamgirimenang.com', 'anything at all', undefined)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('answers an unknown email exactly like a wrong password', async () => {
      await expect(service.login('nobody@ptamgirimenang.com', 'whatever123', undefined)).rejects.toThrow(
        'Email atau password salah',
      );
    });

    it('locks the account after five wrong passwords, even for the right one', async () => {
      await setPassword('hary@ptamgirimenang.com', 'correct horse battery');
      for (let i = 0; i < 5; i++) {
        await expect(service.login('hary@ptamgirimenang.com', 'wrong password', undefined)).rejects.toThrow(
          'Email atau password salah',
        );
      }
      await expect(service.login('hary@ptamgirimenang.com', 'correct horse battery', undefined)).rejects.toThrow(
        /dikunci sementara/,
      );
    });

    it('logout deletes the minted key and forgets the login', async () => {
      // Another usable admin key exists (like the bootstrap "Default Admin Key"), so the
      // last-admin guard lets the delete through.
      await keys.save(
        keys.create({
          name: 'Default Admin Key',
          keyHash: 'd'.repeat(64),
          keyPrefix: 'owa_k1_ddddd',
          role: ApiKeyRole.ADMIN,
        }),
      );
      await setPassword('hary@ptamgirimenang.com', 'correct horse battery');
      await service.login('hary@ptamgirimenang.com', 'correct horse battery', undefined);
      const key = await keys.findOneByOrFail({ name: 'Dashboard: hary@ptamgirimenang.com' });

      await expect(service.logout(key)).resolves.toBe(true);
      expect(await keys.findOneBy({ id: key.id })).toBeNull();
      expect(await loginSessions.count()).toBe(0);
    });

    it('logout expires the key instead when it is the last usable admin key', async () => {
      await setPassword('hary@ptamgirimenang.com', 'correct horse battery');
      await service.login('hary@ptamgirimenang.com', 'correct horse battery', undefined);
      const key = await keys.findOneByOrFail({ name: 'Dashboard: hary@ptamgirimenang.com' });

      await expect(service.logout(key)).resolves.toBe(true);
      const after = await keys.findOneByOrFail({ id: key.id });
      expect(after.expiresAt!.getTime()).toBeLessThan(Date.now());
      expect(await loginSessions.count()).toBe(0);
    });

    it('logout ignores a key that is not a dashboard login', async () => {
      const plain = keys.create({ name: 'integration', keyHash: 'x'.repeat(64), keyPrefix: 'owa_k1_xxxxx' });
      await keys.save(plain);
      await expect(service.logout(plain)).resolves.toBe(false);
      expect(await keys.findOneBy({ id: plain.id })).not.toBeNull();
    });
  });

  describe('password reset', () => {
    it('emails a link that sets the password once, then signs out open logins', async () => {
      await setPassword('hary@ptamgirimenang.com', 'old password 123');
      await service.login('hary@ptamgirimenang.com', 'old password 123', undefined);

      await service.requestPasswordReset('HARY@ptamgirimenang.com', undefined);
      expect(mail.send).toHaveBeenCalledWith(expect.objectContaining({ to: 'hary@ptamgirimenang.com' }));
      const token = emailedToken();
      expect(mail.send.mock.calls[0][0].text).toContain('https://owa.example.test/reset-password?token=');

      await service.resetPassword(token, 'new password 456');
      expect(await loginSessions.count()).toBe(0);
      await expect(service.login('hary@ptamgirimenang.com', 'new password 456', undefined)).resolves.toMatchObject({
        role: ApiKeyRole.ADMIN,
      });
      await expect(service.resetPassword(token, 'another password 789')).rejects.toThrow(GoneException);
    });

    it('sends nothing for an address without an account', async () => {
      await service.requestPasswordReset('stranger@ptamgirimenang.com', undefined);
      expect(mail.send).not.toHaveBeenCalled();
    });

    it('rejects an unknown token and a too-short password', async () => {
      await expect(service.resetPassword('f'.repeat(64), 'long enough pw')).rejects.toThrow(NotFoundException);
      await service.requestPasswordReset('hary@ptamgirimenang.com', undefined);
      await expect(service.resetPassword(emailedToken(), 'short')).rejects.toThrow(/10–128 karakter/);
    });

    it('drops the reset row when the email cannot be sent', async () => {
      mail.send.mockRejectedValueOnce(new Error('smtp down'));
      await expect(service.requestPasswordReset('hary@ptamgirimenang.com', undefined)).rejects.toThrow(
        /tidak dapat dikirim/,
      );
      expect(await resets.count()).toBe(0);
    });
  });
});
