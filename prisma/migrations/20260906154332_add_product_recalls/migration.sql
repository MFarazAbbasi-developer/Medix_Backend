-- CreateEnum
CREATE TYPE "RecallSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "RecallStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "DocumentType" ADD VALUE 'PRODUCT_RECALL';

-- CreateTable
CREATE TABLE "product_recalls" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "recall_number" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "severity" "RecallSeverity" NOT NULL DEFAULT 'HIGH',
    "status" "RecallStatus" NOT NULL DEFAULT 'OPEN',
    "recall_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "created_by_id" TEXT,
    "resolved_by_id" TEXT,
    "resolved_at" TIMESTAMP(3),
    "cancelled_by_id" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "cancellation_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_recalls_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_recalls_organization_id_product_id_idx" ON "product_recalls"("organization_id", "product_id");

-- CreateIndex
CREATE INDEX "product_recalls_batch_id_idx" ON "product_recalls"("batch_id");

-- CreateIndex
CREATE INDEX "product_recalls_status_idx" ON "product_recalls"("status");

-- CreateIndex
CREATE UNIQUE INDEX "product_recalls_organization_id_recall_number_key" ON "product_recalls"("organization_id", "recall_number");

-- AddForeignKey
ALTER TABLE "product_recalls" ADD CONSTRAINT "product_recalls_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_recalls" ADD CONSTRAINT "product_recalls_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_recalls" ADD CONSTRAINT "product_recalls_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_recalls" ADD CONSTRAINT "product_recalls_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_recalls" ADD CONSTRAINT "product_recalls_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_recalls" ADD CONSTRAINT "product_recalls_cancelled_by_id_fkey" FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
