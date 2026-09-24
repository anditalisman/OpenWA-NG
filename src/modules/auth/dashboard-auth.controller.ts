import { Body, Controller, HttpCode, HttpStatus, Post, Req, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { DashboardAuthService } from './dashboard-auth.service';
import { RecaptchaService } from './recaptcha.service';
import {
  DashboardForgotPasswordDto,
  DashboardLoginDto,
  DashboardLoginResponseDto,
  DashboardLogoutResponseDto,
  DashboardResetPasswordDto,
  DashboardSubmittedResponseDto,
} from './dto';
import { CurrentApiKey, Public } from './decorators/auth.decorators';
import { ApiKey } from './entities/api-key.entity';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/entities/audit-log.entity';
import { resolveClientIp } from '../../common/utils/ip';

/**
 * Dashboard sign-in with email + password. Login, forgot and reset are @Public (there is no key
 * yet); anti-abuse is the global ThrottlerGuard, reCAPTCHA when enabled, and the per-account
 * lockout in DashboardAuthService. Logout is authenticated: it ends the login behind the calling key.
 */
@ApiTags('auth')
@Controller('auth/dashboard')
export class DashboardAuthController {
  constructor(
    private readonly dashboardAuthService: DashboardAuthService,
    private readonly recaptchaService: RecaptchaService,
    private readonly auditService: AuditService,
    private readonly configService: ConfigService,
  ) {}

  private getClientIp(request: Request): string {
    const trustedProxies = this.configService.get<string[]>('security.trustedProxies') ?? [];
    return resolveClientIp(request, trustedProxies);
  }

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

  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign in to the dashboard with email and password' })
  @ApiResponse({ status: 200, description: 'Signed in', type: DashboardLoginResponseDto })
  @ApiResponse({ status: 400, description: 'reCAPTCHA verification failed (only when RECAPTCHA_ENABLED=true)' })
  @ApiResponse({ status: 401, description: 'Wrong email or password, or the account is temporarily locked' })
  async login(@Body() dto: DashboardLoginDto, @Req() req: Request): Promise<DashboardLoginResponseDto> {
    const ipAddress = this.getClientIp(req);
    const email = dto.email.trim().toLowerCase();
    await this.assertHuman(dto.recaptchaToken, 'dashboard_login', req, ipAddress, email);
    try {
      const result = await this.dashboardAuthService.login(email, dto.password, ipAddress);
      await this.auditService.logInfo(AuditAction.DASHBOARD_LOGIN_SUCCEEDED, {
        ipAddress,
        method: req.method,
        path: req.path,
        metadata: { email, role: result.role },
      });
      return { apiKey: result.apiKey, role: result.role, email: result.email, expiresAt: result.expiresAt };
    } catch (err) {
      if (err instanceof UnauthorizedException) {
        await this.auditService.logWarn(AuditAction.DASHBOARD_LOGIN_FAILED, {
          ipAddress,
          method: req.method,
          path: req.path,
          errorMessage: err.message,
          metadata: { email },
        });
      }
      throw err;
    }
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'End the dashboard login behind the calling key' })
  @ApiResponse({ status: 200, description: 'Logged out', type: DashboardLogoutResponseDto })
  async logout(@CurrentApiKey() apiKey: ApiKey, @Req() req: Request): Promise<DashboardLogoutResponseDto> {
    const loggedOut = apiKey ? await this.dashboardAuthService.logout(apiKey) : false;
    if (loggedOut) {
      await this.auditService.logInfo(AuditAction.DASHBOARD_LOGOUT, {
        apiKey,
        ipAddress: this.getClientIp(req),
        method: req.method,
        path: req.path,
      });
    }
    return { loggedOut };
  }

  @Post('forgot-password')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Email a single-use link to set or reset the dashboard password' })
  @ApiResponse({ status: 200, description: 'Accepted for processing', type: DashboardSubmittedResponseDto })
  @ApiResponse({ status: 400, description: 'reCAPTCHA verification failed (only when RECAPTCHA_ENABLED=true)' })
  @ApiResponse({ status: 503, description: 'The email could not be sent' })
  async forgotPassword(
    @Body() dto: DashboardForgotPasswordDto,
    @Req() req: Request,
  ): Promise<DashboardSubmittedResponseDto> {
    const ipAddress = this.getClientIp(req);
    const email = dto.email.trim().toLowerCase();
    await this.assertHuman(dto.recaptchaToken, 'dashboard_forgot_password', req, ipAddress, email);
    await this.dashboardAuthService.requestPasswordReset(email, ipAddress);
    await this.auditService.logInfo(AuditAction.DASHBOARD_PASSWORD_RESET_REQUESTED, {
      ipAddress,
      method: req.method,
      path: req.path,
      metadata: { email },
    });
    return { submitted: true };
  }

  @Post('reset-password')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Set a new dashboard password from an emailed link (single use)' })
  @ApiResponse({ status: 200, description: 'Password set', type: DashboardSubmittedResponseDto })
  @ApiResponse({ status: 400, description: 'Password too short or too long' })
  @ApiResponse({ status: 404, description: 'Unknown link' })
  @ApiResponse({ status: 410, description: 'Link already used or expired' })
  async resetPassword(
    @Body() dto: DashboardResetPasswordDto,
    @Req() req: Request,
  ): Promise<DashboardSubmittedResponseDto> {
    const user = await this.dashboardAuthService.resetPassword(dto.token, dto.password);
    await this.auditService.logInfo(AuditAction.DASHBOARD_PASSWORD_RESET, {
      ipAddress: this.getClientIp(req),
      method: req.method,
      path: req.path,
      metadata: { email: user.email },
    });
    return { submitted: true };
  }
}
