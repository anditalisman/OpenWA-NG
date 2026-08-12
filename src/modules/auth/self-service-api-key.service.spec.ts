import { DataSource } from 'typeorm';
import { GoneException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { SelfServiceApiKeyService } from './self-service-api-key.service';
import { SelfServiceKeyRequest } from './entities/self-service-key-request.entity';
import { ApiKeyRole, type ApiKey } from './entities/api-key.entity';
import type { AuthService } from './auth.service';
import type { MailService, SendMailOptions } from '../../common/mail/mail.service';

// Requests from a non-allow-listed domain must produce IDENTICAL externally-observable behaviour
// to a rejected/unknown request — no row, no email, no error surfaced to the caller — so the
// endpoint on top of this service can't be used to enumerate configured domains.
describe('SelfServiceApiKeyService', () => {
  let ds: DataSource;
  let service: SelfServiceApiKeyService;
  let authService: {
    createApiKey: jest.Mock<Promise<{ apiKey: ApiKey; rawKey: string }>, [{ name: string; role?: ApiKeyRole }]>;
  };
  let mailService: { send: jest.Mock<Promise<void>, [SendMailOptions]> };
  const ENV_KEYS = [
    'SELF_SERVICE_API_KEYS_ENABLED',
    'SELF_SERVICE_ALLOWED_EMAIL_DOMAINS',
    'SELF_SERVICE_TOKEN_TTL_MINUTES',
    'DASHBOARD_URL',
    'BASE_URL',
  ];
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
    process.env.SELF_SERVICE_API_KEYS_ENABLED = 'true';
    process.env.SELF_SERVICE_ALLOWED_EMAIL_DOMAINS = 'ptamgirimenang.com, other.co.id';
    process.env.DASHBOARD_URL = 'https://dashboard.example.com';
    delete process.env.SELF_SERVICE_TOKEN_TTL_MINUTES;
    delete process.env.BASE_URL;

    ds = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [SelfServiceKeyRequest],
      synchronize: true,
    });
    await ds.initialize();

    authService = {
      createApiKey: jest
        .fn<Promise<{ apiKey: ApiKey; rawKey: string }>, [{ name: string; role?: ApiKeyRole }]>()
        .mockResolvedValue({
          apiKey: { id: 'key-1', name: 'test', role: ApiKeyRole.OPERATOR } as ApiKey,
          rawKey: 'owa_k1_rawkey',
        }),
    };
    mailService = { send: jest.fn<Promise<void>, [SendMailOptions]>().mockResolvedValue(undefined) };

    service = new SelfServiceApiKeyService(
      ds.getRepository(SelfServiceKeyRequest),
      authService as unknown as AuthService,
      mailService as unknown as MailService,
    );
  });

  afterEach(async () => {
    await ds.destroy();
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  describe('requestKey', () => {
    it('throws when the feature is disabled', async () => {
      process.env.SELF_SERVICE_API_KEYS_ENABLED = 'false';
      await expect(service.requestKey({ name: 'Budi', email: 'budi@ptamgirimenang.com' })).rejects.toThrow(
        ServiceUnavailableException,
      );
      expect(mailService.send).not.toHaveBeenCalled();
    });

    it('accepts a case-insensitive match against the allow-list, stores a hashed token, and emails the raw one', async () => {
      await service.requestKey({ name: 'Budi', email: 'Budi@PTAMGiriMenang.com' });

      const rows = await ds.getRepository(SelfServiceKeyRequest).find();
      expect(rows).toHaveLength(1);
      expect(rows[0].email).toBe('budi@ptamgirimenang.com');
      expect(rows[0].consumedAt).toBeNull();

      expect(mailService.send).toHaveBeenCalledTimes(1);
      const sent = mailService.send.mock.calls[0][0];
      expect(sent.to).toBe('budi@ptamgirimenang.com');
      const [, rawToken] = /token=([0-9a-f]+)/.exec(sent.text) ?? [];
      expect(rawToken).toBeTruthy();
      // The stored hash must not be (and must not contain) the raw token.
      expect(rows[0].tokenHash).not.toBe(rawToken);
      expect(rows[0].tokenHash).toHaveLength(64); // sha256 hex
    });

    it('silently drops a request from a non-allow-listed domain (no row, no email, no error)', async () => {
      await expect(service.requestKey({ name: 'Eve', email: 'eve@evil.example' })).resolves.toBeUndefined();
      expect(mailService.send).not.toHaveBeenCalled();
      expect(await ds.getRepository(SelfServiceKeyRequest).count()).toBe(0);
    });
  });

  describe('verifyAndIssue', () => {
    async function seedRequest(overrides: Partial<SelfServiceKeyRequest> = {}): Promise<string> {
      await service.requestKey({ name: 'Budi', email: 'budi@ptamgirimenang.com' });
      const sent = mailService.send.mock.calls[0][0];
      const [, rawToken] = /token=([0-9a-f]+)/.exec(sent.text) ?? [];
      if (Object.keys(overrides).length > 0) {
        const repo = ds.getRepository(SelfServiceKeyRequest);
        const row = await repo.findOneOrFail({ where: {} });
        await repo.save({ ...row, ...overrides });
      }
      return rawToken;
    }

    it('throws when the feature is disabled', async () => {
      const token = await seedRequest();
      process.env.SELF_SERVICE_API_KEYS_ENABLED = 'false';
      await expect(service.verifyAndIssue(token)).rejects.toThrow(ServiceUnavailableException);
    });

    it('rejects an unknown token', async () => {
      await expect(service.verifyAndIssue('nope')).rejects.toThrow(NotFoundException);
    });

    it('issues an OPERATOR key with no explicit allowedSessions and marks the request consumed', async () => {
      const token = await seedRequest();

      const result = await service.verifyAndIssue(token);

      expect(authService.createApiKey).toHaveBeenCalledWith({ name: 'Budi', role: ApiKeyRole.OPERATOR });
      expect(authService.createApiKey.mock.calls[0][0]).not.toHaveProperty('allowedSessions');
      expect(result.rawKey).toBe('owa_k1_rawkey');

      const row = await ds.getRepository(SelfServiceKeyRequest).findOneOrFail({ where: {} });
      expect(row.consumedAt).not.toBeNull();
    });

    it('rejects reusing an already-consumed token', async () => {
      const token = await seedRequest();
      await service.verifyAndIssue(token);
      await expect(service.verifyAndIssue(token)).rejects.toThrow(GoneException);
      expect(authService.createApiKey).toHaveBeenCalledTimes(1);
    });

    it('rejects an expired token without issuing a key', async () => {
      const token = await seedRequest({ expiresAt: new Date(Date.now() - 60_000) });
      await expect(service.verifyAndIssue(token)).rejects.toThrow(GoneException);
      expect(authService.createApiKey).not.toHaveBeenCalled();
    });
  });
});
