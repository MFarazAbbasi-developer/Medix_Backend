import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsPositive,
  IsOptional,
  IsArray,
  ValidateNested,
  IsDateString,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class PdcAllocationItemDto {
  @IsString()
  @IsNotEmpty()
  salesInvoiceId: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amountAllocated: number;
}

export class CreatePdcDto {
  @IsString()
  @IsNotEmpty()
  customerId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  chequeNumber: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  bankName: string;

  @IsDateString()
  @IsNotEmpty()
  chequeDate: string;

  @IsOptional()
  @IsDateString()
  receivedDate?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PdcAllocationItemDto)
  allocations?: PdcAllocationItemDto[];
}
