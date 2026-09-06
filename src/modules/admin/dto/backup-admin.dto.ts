import { IsString, IsOptional, Equals } from 'class-validator';

export class CreateBackupDto {
  @IsOptional()
  @IsString()
  targetDirectory?: string;

  @IsOptional()
  @IsString()
  label?: string;
}

export class RestoreBackupDto {
  @IsString()
  filename!: string;

  @IsString()
  @Equals('CONFIRM_RESTORE', {
    message: 'confirmationToken must be exactly "CONFIRM_RESTORE"',
  })
  confirmationToken!: string;
}
