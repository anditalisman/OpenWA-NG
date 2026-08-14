import 'reflect-metadata';
import type { Request } from 'express';
import { SelfServiceApiKeyController } from './self-service-api-key.controller';
import { PUBLIC_KEY } from './decorators/auth.decorators';
import { AuditAction } from '../audit/entities/audit-log.entity';
import type { SelfServiceApiKeyService } from './self-service-api-key.service';
import type { AuditService } from '../audit/audit.service';
import { ApiKeyRole, type ApiKey } from './entities/api-key.entity';
import type { SelfServiceKeyRequest } from './entities/self-service-key-request.entity';

// This whole controller is unauthenticated by design — the @Public marker at the class level is
// what makes the guard skip it. If that marker is ever dropped, the route 401s for every caller
// (no key exists to present yet), silently breaking the flow — lock it here.
describe('SelfServiceApiKeyController — public marker', () => {
  it('is marked @Public at the class level', () => {
    expect(Reflect.getMetadata(PUBLIC_KEY, SelfServiceApiKeyController)).toBe(true);
  });
});

describe('SelfServiceApiKeyController — audit logging + response shape', () => {
  const makeReq = (): Request =>
    ({ method: 'POST', path: '/auth/api-keys/self-service/request' }) as unknown as Request;

  let selfServiceService: {
    requestKey: jest.Mock;
    verifyAndIssue: jest.Mock;
    requestRecovery: jest.Mock;
    verifyAndRecover: jest.Mock;
  };
  let auditService: { logInfo: jest.Mock };
  let controller: SelfServiceApiKeyController;

  beforeEach(() => {
    selfServiceService = {
      requestKey: jest.fn().mockResolvedValue(undefined),
      verifyAndIssue: jest.fn().mockResolvedValue({
        apiKey: { id: 'k1', name: 'Budi', role: ApiKeyRole.OPERATOR } as ApiKey,
        rawKey: 'owa_k1_raw',
        request: { email: 'budi@ptamgirimenang.com' } as SelfServiceKeyRequest,
      }),
      requestRecovery: jest.fn().mockResolvedValue(undefined),
      verifyAndRecover: jest.fn().mockResolvedValue({
        apiKey: { id: 'k2', name: 'Budi', role: ApiKeyRole.OPERATOR } as ApiKey,
        rawKey: 'owa_k1_new',
        request: { email: 'budi@ptamgirimenang.com' } as SelfServiceKeyRequest,
        revokedCount: 1,
      }),
    };
    auditService = { logInfo: jest.fn().mockResolvedValue(null) };
    const configService = { get: jest.fn().mockReturnValue([]) };

    controller = new SelfServiceApiKeyController(
      selfServiceService as unknown as SelfServiceApiKeyService,
      auditService as unknown as AuditService,
      configService as never,
    );
  });

  it('request() always returns {submitted:true} and audits with the (lowercased) email in metadata', async () => {
    const res = await controller.request({ name: 'Budi', email: 'Budi@Example.com' }, makeReq());
    expect(res).toEqual({ submitted: true });
    expect(selfServiceService.requestKey).toHaveBeenCalledWith(
      { name: 'Budi', email: 'Budi@Example.com' },
      expect.any(String),
    );
    expect(auditService.logInfo).toHaveBeenCalledWith(
      AuditAction.API_KEY_SELF_SERVICE_REQUESTED,
      expect.objectContaining({ metadata: { email: 'budi@example.com', name: 'Budi' } }),
    );
  });

  it('verify() returns the issued key and audits the issuance', async () => {
    const res = await controller.verify({ token: 'tok' }, makeReq());
    expect(res).toEqual({ id: 'k1', name: 'Budi', apiKey: 'owa_k1_raw', role: ApiKeyRole.OPERATOR });
    expect(auditService.logInfo).toHaveBeenCalledWith(
      AuditAction.API_KEY_SELF_SERVICE_ISSUED,
      expect.objectContaining({
        metadata: { targetKeyId: 'k1', targetKeyName: 'Budi', email: 'budi@ptamgirimenang.com' },
      }),
    );
  });

  it('forgot() always returns {submitted:true} and audits with the (lowercased) email in metadata', async () => {
    const res = await controller.forgot({ name: 'Budi', email: 'Budi@Example.com' }, makeReq());
    expect(res).toEqual({ submitted: true });
    expect(selfServiceService.requestRecovery).toHaveBeenCalledWith(
      { name: 'Budi', email: 'Budi@Example.com' },
      expect.any(String),
    );
    expect(auditService.logInfo).toHaveBeenCalledWith(
      AuditAction.API_KEY_SELF_SERVICE_RECOVERY_REQUESTED,
      expect.objectContaining({ metadata: { email: 'budi@example.com', name: 'Budi' } }),
    );
  });

  it('forgotVerify() returns the replacement key + revokedCount and audits the recovery', async () => {
    const res = await controller.forgotVerify({ token: 'tok' }, makeReq());
    expect(res).toEqual({ id: 'k2', name: 'Budi', apiKey: 'owa_k1_new', role: ApiKeyRole.OPERATOR, revokedCount: 1 });
    expect(auditService.logInfo).toHaveBeenCalledWith(
      AuditAction.API_KEY_SELF_SERVICE_RECOVERED,
      expect.objectContaining({
        metadata: { targetKeyId: 'k2', targetKeyName: 'Budi', email: 'budi@ptamgirimenang.com', revokedCount: 1 },
      }),
    );
  });
});
