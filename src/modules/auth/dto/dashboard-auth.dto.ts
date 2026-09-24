import { IsEmail, IsString, IsOptional, MinLength, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ApiKeyRole } from '../entities/api-key.entity';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../dashboard-password';

const RECAPTCHA_DESCRIPTION =
  'Google reCAPTCHA v3 token from the widget. Required (and verified server-side) only when ' +
  'RECAPTCHA_ENABLED=true on this instance; ignored otherwise.';

export class DashboardLoginDto {
  @ApiProperty({ example: 'hary@ptamgirimenang.com' })
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(PASSWORD_MAX_LENGTH)
  password!: string;

  @ApiPropertyOptional({ description: RECAPTCHA_DESCRIPTION })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  recaptchaToken?: string;
}

export class DashboardLoginResponseDto {
  @ApiProperty({ description: 'Short-lived API key for this dashboard login. Sent as X-API-Key.' })
  apiKey!: string;

  @ApiProperty({ enum: ApiKeyRole })
  role!: ApiKeyRole;

  @ApiProperty()
  email!: string;

  @ApiProperty({ description: 'When this login ends and the key stops working' })
  expiresAt!: Date;
}

export class DashboardForgotPasswordDto {
  @ApiProperty({ example: 'hary@ptamgirimenang.com' })
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @ApiPropertyOptional({ description: RECAPTCHA_DESCRIPTION })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  recaptchaToken?: string;
}

export class DashboardResetPasswordDto {
  @ApiProperty({ description: 'The token from the emailed link' })
  @IsString()
  @MinLength(10)
  @MaxLength(200)
  token!: string;

  @ApiProperty({ minLength: PASSWORD_MIN_LENGTH, maxLength: PASSWORD_MAX_LENGTH })
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(PASSWORD_MAX_LENGTH)
  password!: string;
}

export class DashboardSubmittedResponseDto {
  @ApiProperty({
    description: 'Always true once accepted — identical whether or not the email has an account.',
  })
  submitted!: boolean;
}

export class DashboardLogoutResponseDto {
  @ApiProperty({ description: 'Whether the presented key was a dashboard login that has now ended' })
  loggedOut!: boolean;
}
