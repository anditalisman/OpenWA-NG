import { BadRequestException } from '@nestjs/common';
import { RecaptchaService } from './recaptcha.service';

type FetchMock = jest.Mock<Promise<{ json: () => Promise<unknown> }>, [string, RequestInit]>;

describe('RecaptchaService', () => {
  const ORIGINAL_ENV = process.env;
  let fetchMock: FetchMock;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    fetchMock = jest.fn() as FetchMock;
    (global as unknown as { fetch: typeof fetch }).fetch = fetchMock;
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    jest.restoreAllMocks();
  });

  describe('isEnabled / siteKey', () => {
    it('is disabled by default and exposes no site key', () => {
      const service = new RecaptchaService();
      expect(service.isEnabled()).toBe(false);
      expect(service.siteKey()).toBeNull();
    });

    it('reports enabled + the configured site key when RECAPTCHA_ENABLED=true', () => {
      process.env.RECAPTCHA_ENABLED = 'true';
      process.env.RECAPTCHA_SITE_KEY = 'site-key-123';
      const service = new RecaptchaService();
      expect(service.isEnabled()).toBe(true);
      expect(service.siteKey()).toBe('site-key-123');
    });
  });

  describe('assertHuman', () => {
    it('no-ops when disabled, even with no token at all', async () => {
      const service = new RecaptchaService();
      await expect(service.assertHuman(undefined, 'action')).resolves.toBeUndefined();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('throws when enabled but no secret key is configured (boot guard bypassed)', async () => {
      process.env.RECAPTCHA_ENABLED = 'true';
      const service = new RecaptchaService();
      await expect(service.assertHuman('tok', 'action')).rejects.toThrow(BadRequestException);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects a missing token without calling Google', async () => {
      process.env.RECAPTCHA_ENABLED = 'true';
      process.env.RECAPTCHA_SECRET_KEY = 'secret';
      const service = new RecaptchaService();
      await expect(service.assertHuman(undefined, 'action')).rejects.toThrow(BadRequestException);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('posts to siteverify with the secret + token + remoteip and passes on success', async () => {
      process.env.RECAPTCHA_ENABLED = 'true';
      process.env.RECAPTCHA_SECRET_KEY = 'secret';
      fetchMock.mockResolvedValue({ json: () => Promise.resolve({ success: true, score: 0.9, action: 'submit' }) });
      const service = new RecaptchaService();

      await expect(service.assertHuman('tok', 'submit', '1.2.3.4')).resolves.toBeUndefined();

      expect(fetchMock).toHaveBeenCalledWith(
        'https://www.google.com/recaptcha/api/siteverify',
        expect.objectContaining({ method: 'POST' }),
      );
      const body = fetchMock.mock.calls[0][1].body as URLSearchParams;
      expect(body.get('secret')).toBe('secret');
      expect(body.get('response')).toBe('tok');
      expect(body.get('remoteip')).toBe('1.2.3.4');
    });

    it('rejects when Google reports success:false', async () => {
      process.env.RECAPTCHA_ENABLED = 'true';
      process.env.RECAPTCHA_SECRET_KEY = 'secret';
      fetchMock.mockResolvedValue({
        json: () => Promise.resolve({ success: false, 'error-codes': ['timeout-or-duplicate'] }),
      });
      const service = new RecaptchaService();

      await expect(service.assertHuman('tok', 'submit')).rejects.toThrow(BadRequestException);
    });

    it('rejects a score below the default threshold (0.5)', async () => {
      process.env.RECAPTCHA_ENABLED = 'true';
      process.env.RECAPTCHA_SECRET_KEY = 'secret';
      fetchMock.mockResolvedValue({ json: () => Promise.resolve({ success: true, score: 0.2, action: 'submit' }) });
      const service = new RecaptchaService();

      await expect(service.assertHuman('tok', 'submit')).rejects.toThrow(BadRequestException);
    });

    it('honors a custom RECAPTCHA_MIN_SCORE', async () => {
      process.env.RECAPTCHA_ENABLED = 'true';
      process.env.RECAPTCHA_SECRET_KEY = 'secret';
      process.env.RECAPTCHA_MIN_SCORE = '0.1';
      fetchMock.mockResolvedValue({ json: () => Promise.resolve({ success: true, score: 0.2, action: 'submit' }) });
      const service = new RecaptchaService();

      await expect(service.assertHuman('tok', 'submit')).resolves.toBeUndefined();
    });

    it('rejects when the reported action does not match the expected one', async () => {
      process.env.RECAPTCHA_ENABLED = 'true';
      process.env.RECAPTCHA_SECRET_KEY = 'secret';
      fetchMock.mockResolvedValue({
        json: () => Promise.resolve({ success: true, score: 0.9, action: 'some_other_action' }),
      });
      const service = new RecaptchaService();

      await expect(service.assertHuman('tok', 'submit')).rejects.toThrow(BadRequestException);
    });

    it('wraps a network/transport failure in a BadRequestException', async () => {
      process.env.RECAPTCHA_ENABLED = 'true';
      process.env.RECAPTCHA_SECRET_KEY = 'secret';
      fetchMock.mockRejectedValue(new Error('ECONNRESET'));
      const service = new RecaptchaService();

      await expect(service.assertHuman('tok', 'submit')).rejects.toThrow(BadRequestException);
    });
  });
});
