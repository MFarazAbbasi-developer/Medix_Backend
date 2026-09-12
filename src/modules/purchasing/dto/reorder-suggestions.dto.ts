import {
  IsString,
  IsOptional,
  IsInt,
  Min,
  Max,
  IsBoolean,
  IsEnum,
  IsArray,
  ValidateNested,
  IsUUID,
  IsNumber,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';

export enum SuggestionHealthStatus {
  ALL = 'ALL',
  REORDER_NEEDED = 'REORDER_NEEDED',
  WATCH = 'WATCH',
  HEALTHY = 'HEALTHY',
  OVERSTOCK = 'OVERSTOCK',
}

export class QuerySuggestionsDto {
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsUUID()
  manufacturerId?: string;

  @IsOptional()
  @IsEnum(SuggestionHealthStatus)
  status?: SuggestionHealthStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  lookbackDays?: number;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  excludeShortExpiry?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(730)
  shortExpiryDays?: number;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 50;
}

export class UpsertReplenishmentConfigDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  reorderPoint?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  targetStock?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  minOrderQuantity?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  reorderQuantity?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  leadTimeDays?: number | null;

  @IsOptional()
  @IsUUID()
  preferredSupplierId?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean = true;
}

export class SuggestionPoItemDto {
  @IsUUID()
  productId: string;

  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  unitCost?: number;

  @IsOptional()
  @IsString()
  remarks?: string;
}

export class CreateDraftPosFromSuggestionsDto {
  @IsUUID()
  branchId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SuggestionPoItemDto)
  items: SuggestionPoItemDto[];

  @IsOptional()
  @IsString()
  notes?: string;
}
