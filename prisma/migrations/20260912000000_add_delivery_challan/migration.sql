-- AlterEnum
ALTER TYPE "DocumentType" ADD VALUE 'DELIVERY_CHALLAN';

-- AlterTable
ALTER TABLE "delivery_fulfillments" ADD COLUMN "challan_number" TEXT NOT NULL DEFAULT '';

-- CreateIndex
CREATE UNIQUE INDEX "delivery_fulfillments_organization_id_challan_number_key" ON "delivery_fulfillments"("organization_id", "challan_number");
