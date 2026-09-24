import { AuthValidateController } from './auth-validate.controller';
import { ApiKey, ApiKeyRole } from './entities/api-key.entity';
import type { DashboardAuthService } from './dashboard-auth.service';
import type { DashboardUser } from './entities/dashboard-user.entity';

describe('AuthValidateController', () => {
  const findSessionUser = jest.fn<Promise<DashboardUser | null>, [string]>();
  const controller = new AuthValidateController({ findSessionUser } as unknown as DashboardAuthService);

  const makeKey = (over: Partial<ApiKey> = {}): ApiKey =>
    ({ id: 'k1', role: ApiKeyRole.OPERATOR, isActive: true, allowedIps: null, ...over }) as ApiKey;

  beforeEach(() => findSessionUser.mockReset().mockResolvedValue(null));

  it('reports the guard-validated key as valid, echoing its role', async () => {
    await expect(controller.validate(makeKey({ role: ApiKeyRole.ADMIN }))).resolves.toEqual({
      valid: true,
      role: ApiKeyRole.ADMIN,
      dashboardSession: false,
    });
  });

  it('returns valid:true for an IP-restricted key (no IP-less re-validation false negative)', async () => {
    // The global guard already validated this key against the real client IP and attached it.
    // The handler must NOT re-validate without an IP, which previously fail-closed and wrongly
    // reported valid:false for any key carrying an allowedIps restriction.
    const key = makeKey({ allowedIps: ['10.0.0.0/24'] });
    await expect(controller.validate(key)).resolves.toEqual({ valid: true, role: key.role, dashboardSession: false });
  });

  it('marks a key minted by a dashboard login, with the signed-in email', async () => {
    findSessionUser.mockResolvedValue({ email: 'hary@ptamgirimenang.com' } as DashboardUser);
    await expect(controller.validate(makeKey({ id: 'dash-key' }))).resolves.toEqual({
      valid: true,
      role: ApiKeyRole.OPERATOR,
      dashboardSession: true,
      email: 'hary@ptamgirimenang.com',
    });
    expect(findSessionUser).toHaveBeenCalledWith('dash-key');
  });

  it('returns valid:false when no key is attached (defense-in-depth)', async () => {
    await expect(controller.validate(undefined)).resolves.toEqual({ valid: false });
  });
});
