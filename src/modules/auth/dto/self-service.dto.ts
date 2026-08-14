import { IsEmail, IsString, MinLength, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

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
