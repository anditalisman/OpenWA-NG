import { BadRequestException, Injectable } from '@nestjs/common';
import { createLogger } from '../../common/services/logger.service';

const SITEVERIFY_URL = 'https://www.google.com/recaptcha/api/siteverify';
const DEFAULT_MIN_SCORE = 0.5;

interface SiteVerifyResponse {
  success: boolean;
  score?: number;
  action?: string;
  'error-codes'?: string[];
}

/**
 * Google reCAPTCHA v3 for the self-service API key endpoints (the only fully unauthenticated
 * surface in this app — no key exists yet for the caller to present). Off by default; every method
 * no-ops when RECAPTCHA_ENABLED!=='true' so callers can invoke assertHuman unconditionally without
 * special-casing disabled deployments.
 */
@Injectable()
export class RecaptchaService {
  private readonly logger = createLogger('RecaptchaService');

  isEnabled(): boolean {
    return process.env.RECAPTCHA_ENABLED === 'true';
  }

  /** The public site key the dashboard needs to render the widget, or null while disabled. */
  siteKey(): string | null {
    if (!this.isEnabled()) return null;
    return process.env.RECAPTCHA_SITE_KEY || null;
  }

  private minScore(): number {
    const parsed = parseFloat(process.env.RECAPTCHA_MIN_SCORE || '');
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : DEFAULT_MIN_SCORE;
  }

  /**
   * Verifies a v3 token against Google's siteverify endpoint for the given action. No-ops when the
   * feature is disabled. Throws BadRequestException on any failure — missing token, a transport
   * error, Google reporting failure, an action mismatch, or a score below the configured threshold
   * — collapsed to one generic message so a caller can't use the response to fingerprint which
   * check tripped.
   */
  async assertHuman(token: string | undefined, action: string, remoteIp?: string): Promise<void> {
    if (!this.isEnabled()) return;

    const secret = process.env.RECAPTCHA_SECRET_KEY;
    if (!secret) {
      // env.validation.ts requires RECAPTCHA_SECRET_KEY whenever RECAPTCHA_ENABLED=true — this only
      // trips if that boot-time guard was bypassed (e.g. the var was unset after boot).
      this.logger.error('RECAPTCHA_ENABLED=true but RECAPTCHA_SECRET_KEY is not set');
      throw new BadRequestException('reCAPTCHA is misconfigured on this server');
    }

    if (!token) {
      throw new BadRequestException('reCAPTCHA verification failed');
    }

    const params = new URLSearchParams({ secret, response: token });
    if (remoteIp) params.set('remoteip', remoteIp);

    let result: SiteVerifyResponse;
    try {
      const res = await fetch(SITEVERIFY_URL, { method: 'POST', body: params });
      result = (await res.json()) as SiteVerifyResponse;
    } catch (error) {
      this.logger.error('reCAPTCHA siteverify request failed', error instanceof Error ? error.stack : String(error));
      throw new BadRequestException('Could not verify reCAPTCHA right now — please try again');
    }

    const scoreOk = typeof result.score !== 'number' || result.score >= this.minScore();
    const actionOk = !result.action || result.action === action;
    if (!result.success || !scoreOk || !actionOk) {
      this.logger.warn('reCAPTCHA verification rejected', {
        action,
        resultAction: result.action,
        score: result.score,
        errorCodes: result['error-codes'],
      });
      throw new BadRequestException('reCAPTCHA verification failed');
    }
  }
}
