import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsBoolean,
  IsEnum,
  IsArray,
  ValidateNested,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PaymentMethod } from '@prisma/client';

export class CreateSalesInvoiceItemDto {
  @IsString()
  @IsNotEmpty()
  productId: string;

  @IsString()
  @IsOptional()
  batchId?: string; // Optional manual batch selection

  @IsNumber()
  @Min(1)
  @Type(() => Number)
  billedQuantity: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
  @Type(() => Number)
  bonusQuantity?: number = 0;

  @IsNumber()
  @IsOptional()
  @Min(0)
  @Type(() => Number)
  unitPrice?: number; // Optional user override (must be <= MRP)

  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  @Type(() => Number)
  discountPercentage?: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  @Type(() => Number)
  taxPercentage?: number;

  @IsBoolean()
  @IsOptional()
  allowMrpOverride?: boolean;

  @IsString()
  @IsOptional()
  mrpOverrideReason?: string;

  @IsString()
  @IsOptional()
  remarks?: string;
}

export class SalesInvoicePaymentTenderDto {
  @IsEnum(PaymentMethod)
  paymentMethod: PaymentMethod;

  @IsNumber()
  @Min(0)
  @Type(() => Number)
  amount: number;

  @IsString()
  @IsOptional()
  referenceNumber?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class CreateSalesInvoiceDto {
  @IsString()
  @IsNotEmpty()
  customerId: string;

  @IsString()
  @IsNotEmpty()
  warehouseId: string;

  @IsEnum(PaymentMethod)
  @IsOptional()
  paymentMethod?: PaymentMethod = PaymentMethod.CASH;

  @IsString()
  @IsOptional()
  invoiceDate?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateSalesInvoiceItemDto)
  items: CreateSalesInvoiceItemDto[];

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => SalesInvoicePaymentTenderDto)
  payments?: SalesInvoicePaymentTenderDto[];

  @IsNumber()
  @IsOptional()
  @Min(0)
  @Type(() => Number)
  overallDiscountAmount?: number = 0;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsString()
  @IsOptional()
  salesmanId?: string;

  @IsString()
  @IsOptional()
  routeId?: string;

  @IsString()
  @IsOptional()
  deliveryAddressId?: string;

  @IsBoolean()
  @IsOptional()
  isDraft?: boolean = false;
}
