import { IsEmail, IsString, IsOptional, MinLength, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RequestSelfServiceApiKeyDto {
  @ApiProperty({
    description: 'Friendly name for the API key that will be issued once the email is verified',
    example: 'Budi — Notifikasi Tagihan',
  })
  @IsString()
  @MinLength(3)
  @MaxLength(100)
  name!: string;

  @ApiProperty({
    description: 'Work email. Must match one of the domains the operator allow-listed for self-service.',
    example: 'budi@ptamgirimenang.com',
  })
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @ApiPropertyOptional({
    description:
      'Google reCAPTCHA v3 token from the widget. Required (and verified server-side) only when ' +
      'RECAPTCHA_ENABLED=true on this instance; ignored otherwise.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  recaptchaToken?: string;
}

export class RecaptchaConfigResponseDto {
  @ApiProperty({ description: 'Whether the self-service forms require a reCAPTCHA token' })
  enabled!: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'The public site key to render the widget with, or null while disabled',
  })
  siteKey!: string | null;
}

export class RequestSelfServiceApiKeyResponseDto {
  @ApiProperty({
    description:
      'Always true when the request was accepted for processing. Deliberately identical whether or ' +
      'not the email domain is allow-listed / already has a pending request, so the endpoint cannot ' +
      'be used to enumerate which domains or addresses are configured.',
  })
  submitted!: boolean;
}

export class VerifySelfServiceApiKeyDto {
  @ApiProperty({ description: 'The token from the verification link' })
  @IsString()
  @MinLength(10)
  @MaxLength(200)
  token!: string;
}

export class VerifySelfServiceApiKeyResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ description: 'Full API key — shown only this once' })
  apiKey!: string;

  @ApiProperty()
  role!: string;
}

export class VerifyForgotApiKeyResponseDto extends VerifySelfServiceApiKeyResponseDto {
  @ApiProperty({ description: 'How many previously active self-service keys for this email were revoked' })
  revokedCount!: number;
}
