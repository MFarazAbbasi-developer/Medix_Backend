import { IsString, IsIn, IsOptional } from 'class-validator';

export const SUPPORTED_DATASETS = [
  'products',
  'batches',
  'customers',
  'suppliers',
  'sales_invoices',
  'purchases',
  'payments',
  'returns',
  'stock',
  'stock_movements',
] as const;

export type SupportedDataset = (typeof SUPPORTED_DATASETS)[number];

export class ExportDatasetDto {
  @IsString()
  @IsIn(SUPPORTED_DATASETS, {
    message: `dataset must be one of: ${SUPPORTED_DATASETS.join(', ')}`,
  })
  dataset!: SupportedDataset;

  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;

  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @IsString()
  warehouseId?: string;
}
