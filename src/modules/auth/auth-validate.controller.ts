import { Controller, Post, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiHeader } from '@nestjs/swagger';
import { CurrentApiKey } from './decorators/auth.decorators';
import { ApiKey } from './entities/api-key.entity';
import { ValidateApiKeyResponseDto } from './dto';
import { DashboardAuthService } from './dashboard-auth.service';

@ApiTags('auth')
@Controller('auth')
export class AuthValidateController {
  constructor(private readonly dashboardAuthService: DashboardAuthService) {}

  @Post('validate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Validate an API key' })
  @ApiHeader({ name: 'X-API-Key', description: 'API key to validate' })
  @ApiResponse({ status: 200, description: 'API key is valid', type: ValidateApiKeyResponseDto })
  @ApiResponse({ status: 401, description: 'Invalid or missing API key' })
  async validate(
    @CurrentApiKey() apiKey?: ApiKey,
  ): Promise<{ valid: boolean; role?: string; dashboardSession?: boolean; email?: string }> {
    // This route is behind the global API-key guard, so only a validated key reaches this handler
    // (a missing/invalid key 401s first). The guard has already verified the key — including its
    // client-IP and session-scope restrictions — and attached it to the request. Re-validating here
    // would repeat that work without the client IP, double-counting usage and, for an IP-restricted
    // key, failing closed (no IP) and wrongly reporting valid:false. So we trust the guard's result.
    // The valid:false branch is unreachable in normal operation; it's retained as defense-in-depth in
    // case the guard config ever changes, keeping the endpoint safe to expose directly.
    if (!apiKey) {
      return { valid: false };
    }
    // The dashboard signs in with email + password only; it uses dashboardSession to refuse any
    // other key (see DashboardAuthService).
    const user = await this.dashboardAuthService.findSessionUser(apiKey.id);
    return user
      ? { valid: true, role: apiKey.role, dashboardSession: true, email: user.email }
      : { valid: true, role: apiKey.role, dashboardSession: false };
  }
}
