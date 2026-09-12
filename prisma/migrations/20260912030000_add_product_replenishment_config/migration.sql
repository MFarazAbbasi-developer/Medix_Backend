-- CreateTable
CREATE TABLE "product_replenishment_configs" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "reorder_point" INTEGER,
    "target_stock" INTEGER,
    "min_order_quantity" INTEGER NOT NULL DEFAULT 1,
    "reorder_quantity" INTEGER,
    "lead_time_days" INTEGER,
    "preferred_supplier_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_replenishment_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_replenishment_configs_organization_id_branch_id_idx" ON "product_replenishment_configs"("organization_id", "branch_id");

-- CreateIndex
CREATE INDEX "product_replenishment_configs_product_id_idx" ON "product_replenishment_configs"("product_id");

-- CreateIndex
CREATE INDEX "product_replenishment_configs_preferred_supplier_id_idx" ON "product_replenishment_configs"("preferred_supplier_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_replenishment_configs_organization_id_branch_id_product_id_key" ON "product_replenishment_configs"("organization_id", "branch_id", "product_id");

-- AddForeignKey
ALTER TABLE "product_replenishment_configs" ADD CONSTRAINT "product_replenishment_configs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_replenishment_configs" ADD CONSTRAINT "product_replenishment_configs_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_replenishment_configs" ADD CONSTRAINT "product_replenishment_configs_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_replenishment_configs" ADD CONSTRAINT "product_replenishment_configs_preferred_supplier_id_fkey" FOREIGN KEY ("preferred_supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
