-- CreateEnum
CREATE TYPE "SchemeType" AS ENUM ('BUY_X_GET_Y_FREE', 'BUY_X_GET_DISCOUNT', 'FLAT_DISCOUNT_PERCENT', 'FLAT_PRICE_OVERRIDE');

-- DropIndex
DROP INDEX "customer_pricing_rules_customer_id_product_id_key";

-- AlterTable
ALTER TABLE "customer_pricing_rules" ADD COLUMN     "end_date" TIMESTAMP(3),
ADD COLUMN     "min_quantity" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "start_date" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "sales_invoice_items" ADD COLUMN     "pricing_rule_id" TEXT,
ADD COLUMN     "pricing_source" TEXT,
ADD COLUMN     "scheme_id" TEXT,
ADD COLUMN     "scheme_name" TEXT;

-- CreateTable
CREATE TABLE "promotional_schemes" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "scheme_type" "SchemeType" NOT NULL DEFAULT 'BUY_X_GET_Y_FREE',
    "product_id" TEXT NOT NULL,
    "min_quantity" INTEGER NOT NULL DEFAULT 1,
    "bonus_quantity" INTEGER NOT NULL DEFAULT 0,
    "bonus_product_id" TEXT,
    "discount_percentage" DECIMAL(5,2),
    "override_price" DECIMAL(12,2),
    "customer_id" TEXT,
    "customer_type" "CustomerType",
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promotional_schemes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "promotional_schemes_organization_id_product_id_is_active_idx" ON "promotional_schemes"("organization_id", "product_id", "is_active");

-- CreateIndex
CREATE INDEX "promotional_schemes_start_date_end_date_idx" ON "promotional_schemes"("start_date", "end_date");

-- CreateIndex
CREATE UNIQUE INDEX "promotional_schemes_organization_id_code_key" ON "promotional_schemes"("organization_id", "code");

-- CreateIndex
CREATE INDEX "customer_pricing_rules_organization_id_customer_id_idx" ON "customer_pricing_rules"("organization_id", "customer_id");

-- CreateIndex
CREATE INDEX "customer_pricing_rules_organization_id_product_id_idx" ON "customer_pricing_rules"("organization_id", "product_id");

-- AddForeignKey
ALTER TABLE "promotional_schemes" ADD CONSTRAINT "promotional_schemes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotional_schemes" ADD CONSTRAINT "promotional_schemes_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotional_schemes" ADD CONSTRAINT "promotional_schemes_bonus_product_id_fkey" FOREIGN KEY ("bonus_product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotional_schemes" ADD CONSTRAINT "promotional_schemes_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
