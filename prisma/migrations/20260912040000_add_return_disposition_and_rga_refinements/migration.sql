-- CreateEnum ReturnStockDisposition
CREATE TYPE "ReturnStockDisposition" AS ENUM ('RESTOCK_SALEABLE', 'QUARANTINE', 'RETURN_TO_SUPPLIER');

-- AlterEnum DocumentType
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'SUPPLIER_RETURN_CHALLAN';

-- Safely migrate PurchaseReturnStatus enum
ALTER TABLE "purchase_returns" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "purchase_returns" ALTER COLUMN "status" TYPE TEXT;

DROP TYPE IF EXISTS "PurchaseReturnStatus_old";
ALTER TYPE "PurchaseReturnStatus" RENAME TO "PurchaseReturnStatus_old";

CREATE TYPE "PurchaseReturnStatus" AS ENUM ('DRAFT', 'DISPATCHED', 'COMPLETED', 'CANCELLED');

UPDATE "purchase_returns" 
SET "status" = CASE 
  WHEN "status" = 'POSTED' THEN 'COMPLETED'
  WHEN "status" = 'CANCELLED' THEN 'CANCELLED'
  WHEN "status" = 'DISPATCHED' THEN 'DISPATCHED'
  ELSE 'DRAFT'
END;

ALTER TABLE "purchase_returns" ALTER COLUMN "status" TYPE "PurchaseReturnStatus" USING ("status"::"PurchaseReturnStatus");
ALTER TABLE "purchase_returns" ALTER COLUMN "status" SET DEFAULT 'DRAFT';

DROP TYPE IF EXISTS "PurchaseReturnStatus_old";

-- AlterTable sales_return_items
ALTER TABLE "sales_return_items" ADD COLUMN "disposition" "ReturnStockDisposition" NOT NULL DEFAULT 'RESTOCK_SALEABLE';

-- AlterTable purchase_returns
ALTER TABLE "purchase_returns" ALTER COLUMN "grn_id" DROP NOT NULL;
ALTER TABLE "purchase_returns" ADD COLUMN "challan_number" TEXT;
ALTER TABLE "purchase_returns" ADD COLUMN "rga_number" TEXT;
ALTER TABLE "purchase_returns" ADD COLUMN "rga_date" TIMESTAMP(3);
ALTER TABLE "purchase_returns" ADD COLUMN "vendor_credit_note_number" TEXT;
ALTER TABLE "purchase_returns" ADD COLUMN "dispatched_at" TIMESTAMP(3);
ALTER TABLE "purchase_returns" ADD COLUMN "dispatched_by_user_id" TEXT;
ALTER TABLE "purchase_returns" ADD COLUMN "completed_at" TIMESTAMP(3);
ALTER TABLE "purchase_returns" ADD COLUMN "completed_by_user_id" TEXT;

-- AlterTable purchase_return_items
ALTER TABLE "purchase_return_items" ALTER COLUMN "grn_item_id" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "purchase_returns_status_idx" ON "purchase_returns"("status");

-- AddForeignKey
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_dispatched_by_user_id_fkey" FOREIGN KEY ("dispatched_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_completed_by_user_id_fkey" FOREIGN KEY ("completed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
