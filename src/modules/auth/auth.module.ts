import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { APP_GUARD } from '@nestjs/core';
import { ApiKey } from './entities/api-key.entity';
import { SelfServiceKeyRequest } from './entities/self-service-key-request.entity';
import { Session } from '../session/entities/session.entity';
import { AuthService } from './auth.service';
import { ApiKeyUsageTracker } from './api-key-usage-tracker.service';
import { SelfServiceApiKeyService } from './self-service-api-key.service';
import { RecaptchaService } from './recaptcha.service';
import { AuthController } from './auth.controller';
import { AuthValidateController } from './auth-validate.controller';
import { SelfServiceApiKeyController } from './self-service-api-key.controller';
import { ApiKeyGuard } from './guards/api-key.guard';
import { ProxyAwareThrottlerGuard } from '../../common/security/proxy-aware-throttler.guard';

@Global()
@Module({
  // Session (on the 'data' connection) is registered here too — not because AuthModule owns
  // sessions, but so AuthService.validateApiKey can resolve a non-admin unscoped key's effective
  // session scope (Session.createdByApiKeyId) without depending on SessionModule and its own
  // dependency on the auth guard/decorators, which would cycle.
  imports: [
    TypeOrmModule.forFeature([ApiKey, SelfServiceKeyRequest], 'main'),
    TypeOrmModule.forFeature([Session], 'data'),
  ],
  controllers: [AuthController, AuthValidateController, SelfServiceApiKeyController],
  providers: [
    AuthService,
    ApiKeyUsageTracker,
    SelfServiceApiKeyService,
    RecaptchaService,
    {
      provide: APP_GUARD,
      useClass: ProxyAwareThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: ApiKeyGuard,
    },
  ],
  exports: [AuthService],
})
export class AuthModule {}
