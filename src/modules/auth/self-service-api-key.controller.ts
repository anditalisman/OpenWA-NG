import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { SelfServiceApiKeyService } from './self-service-api-key.service';
import { RecaptchaService } from './recaptcha.service';
import {
  RequestSelfServiceApiKeyDto,
  RequestSelfServiceApiKeyResponseDto,
  VerifySelfServiceApiKeyDto,
  VerifySelfServiceApiKeyResponseDto,
  VerifyForgotApiKeyResponseDto,
  RecaptchaConfigResponseDto,
} from './dto';
import { Public } from './decorators/auth.decorators';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/entities/audit-log.entity';
import { resolveClientIp } from '../../common/utils/ip';

/**
 * Fully unauthenticated (@Public) surface for the self-service API key flow — there is no key yet
 * for the caller to present. Anti-abuse is the global ThrottlerGuard (still applies to @Public
 * routes) plus the email-domain allow-list and single-use, time-boxed verification token enforced
 * in SelfServiceApiKeyService.
 */
@ApiTags('auth')
@Controller('auth/api-keys/self-service')
@Public()
export class SelfServiceApiKeyController {
  constructor(
    private readonly selfServiceService: SelfServiceApiKeyService,
    private readonly recaptchaService: RecaptchaService,
    private readonly auditService: AuditService,
    private readonly configService: ConfigService,
  ) {}

  private getClientIp(request: Request): string {
    const trustedProxies = this.configService.get<string[]>('security.trustedProxies') ?? [];
    return resolveClientIp(request, trustedProxies);
  }

  /**
   * Verifies dto.recaptchaToken for the given action, auditing (and rethrowing) a rejection — same
   * catch-audit-rethrow shape as ApiKeyGuard for API_KEY_AUTH_FAILED. No-ops when RECAPTCHA_ENABLED
   * is not 'true', so this can be called unconditionally from every public entry point below.
   */
  private async assertHuman(
    recaptchaToken: string | undefined,
    action: string,
    req: Request,
    ipAddress: string,
    email: string,
  ): Promise<void> {
    try {
      await this.recaptchaService.assertHuman(recaptchaToken, action, ipAddress);
    } catch (err) {
      await this.auditService.logWarn(AuditAction.API_KEY_SELF_SERVICE_RECAPTCHA_FAILED, {
        ipAddress,
        method: req.method,
        path: req.path,
        errorMessage: err instanceof Error ? err.message : String(err),
        metadata: { email, action },
      });
      throw err;
    }
  }

  @Get('recaptcha-config')
  @ApiOperation({ summary: 'Whether the self-service forms require reCAPTCHA, and the site key to render it with' })
  @ApiResponse({ status: 200, description: 'reCAPTCHA config', type: RecaptchaConfigResponseDto })
  recaptchaConfig(): RecaptchaConfigResponseDto {
    return { enabled: this.recaptchaService.isEnabled(), siteKey: this.recaptchaService.siteKey() };
  }

  @Post('request')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request a self-service API key (sends a verification email)' })
  @ApiResponse({ status: 200, description: 'Accepted for processing', type: RequestSelfServiceApiKeyResponseDto })
  @ApiResponse({
    status: 400,
    description: 'reCAPTCHA verification failed (only when RECAPTCHA_ENABLED=true on this instance)',
  })
  @ApiResponse({
    status: 503,
    description:
      'Self-service API key requests are disabled on this instance, or the verification email could not be sent',
  })
  async request(
    @Body() dto: RequestSelfServiceApiKeyDto,
    @Req() req: Request,
  ): Promise<RequestSelfServiceApiKeyResponseDto> {
    const ipAddress = this.getClientIp(req);
    await this.assertHuman(dto.recaptchaToken, 'self_service_request', req, ipAddress, dto.email);
    await this.selfServiceService.requestKey(dto, ipAddress);
    await this.auditService.logInfo(AuditAction.API_KEY_SELF_SERVICE_REQUESTED, {
      ipAddress,
      method: req.method,
      path: req.path,
      metadata: { email: dto.email.trim().toLowerCase(), name: dto.name },
    });
    // Same response regardless of whether the domain was allow-listed — see requestKey().
    return { submitted: true };
  }

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify a self-service request and issue the API key (single use)' })
  @ApiResponse({
    status: 200,
    description: 'The issued API key (shown once)',
    type: VerifySelfServiceApiKeyResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Unknown verification token' })
  @ApiResponse({ status: 410, description: 'Token already used or expired' })
  @ApiResponse({ status: 503, description: 'Self-service API key requests are disabled on this instance' })
  async verify(
    @Body() dto: VerifySelfServiceApiKeyDto,
    @Req() req: Request,
  ): Promise<VerifySelfServiceApiKeyResponseDto> {
    const ipAddress = this.getClientIp(req);
    const { apiKey, rawKey, request: ssRequest } = await this.selfServiceService.verifyAndIssue(dto.token);
    await this.auditService.logInfo(AuditAction.API_KEY_SELF_SERVICE_ISSUED, {
      ipAddress,
      method: req.method,
      path: req.path,
      metadata: { targetKeyId: apiKey.id, targetKeyName: apiKey.name, email: ssRequest.email },
    });
    return { id: apiKey.id, name: apiKey.name, apiKey: rawKey, role: apiKey.role };
  }

  @Post('forgot')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request recovery of a lost self-service API key (sends a verification email)' })
  @ApiResponse({ status: 200, description: 'Accepted for processing', type: RequestSelfServiceApiKeyResponseDto })
  @ApiResponse({
    status: 400,
    description: 'reCAPTCHA verification failed (only when RECAPTCHA_ENABLED=true on this instance)',
  })
  @ApiResponse({
    status: 503,
    description:
      'Self-service API key requests are disabled on this instance, or the verification email could not be sent',
  })
  async forgot(
    @Body() dto: RequestSelfServiceApiKeyDto,
    @Req() req: Request,
  ): Promise<RequestSelfServiceApiKeyResponseDto> {
    const ipAddress = this.getClientIp(req);
    await this.assertHuman(dto.recaptchaToken, 'self_service_forgot', req, ipAddress, dto.email);
    await this.selfServiceService.requestRecovery(dto, ipAddress);
    await this.auditService.logInfo(AuditAction.API_KEY_SELF_SERVICE_RECOVERY_REQUESTED, {
      ipAddress,
      method: req.method,
      path: req.path,
      metadata: { email: dto.email.trim().toLowerCase(), name: dto.name },
    });
    // Same response regardless of whether the domain was allow-listed / a matching key exists —
    // see SelfServiceApiKeyService.requestRecovery().
    return { submitted: true };
  }

  @Post('forgot/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify a recovery request: revoke the old key(s) for this email and issue a replacement (single use)',
  })
  @ApiResponse({
    status: 200,
    description: 'The replacement API key (shown once)',
    type: VerifyForgotApiKeyResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Unknown verification token' })
  @ApiResponse({ status: 410, description: 'Token already used or expired' })
  @ApiResponse({ status: 503, description: 'Self-service API key requests are disabled on this instance' })
  async forgotVerify(
    @Body() dto: VerifySelfServiceApiKeyDto,
    @Req() req: Request,
  ): Promise<VerifyForgotApiKeyResponseDto> {
    const ipAddress = this.getClientIp(req);
    const {
      apiKey,
      rawKey,
      request: ssRequest,
      revokedCount,
    } = await this.selfServiceService.verifyAndRecover(dto.token);
    await this.auditService.logInfo(AuditAction.API_KEY_SELF_SERVICE_RECOVERED, {
      ipAddress,
      method: req.method,
      path: req.path,
      metadata: { targetKeyId: apiKey.id, targetKeyName: apiKey.name, email: ssRequest.email, revokedCount },
    });
    return { id: apiKey.id, name: apiKey.name, apiKey: rawKey, role: apiKey.role, revokedCount };
  }
}
