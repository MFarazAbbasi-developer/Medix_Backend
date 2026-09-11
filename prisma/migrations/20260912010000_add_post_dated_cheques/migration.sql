-- AlterEnum
ALTER TYPE "DocumentType" ADD VALUE 'PDC';

-- CreateEnum
CREATE TYPE "PdcStatus" AS ENUM ('RECEIVED', 'DEPOSITED', 'CLEARED', 'BOUNCED', 'CANCELLED');

-- CreateTable
CREATE TABLE "post_dated_cheques" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "pdc_number" TEXT NOT NULL,
    "cheque_number" TEXT NOT NULL,
    "bank_name" TEXT NOT NULL,
    "cheque_date" TIMESTAMP(3) NOT NULL,
    "received_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "amount" DECIMAL(12,2) NOT NULL,
    "allocated_amount" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "unallocated_amount" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "status" "PdcStatus" NOT NULL DEFAULT 'RECEIVED',
    "notes" TEXT,
    "deposit_bank_name" TEXT,
    "deposit_reference" TEXT,
    "deposited_at" TIMESTAMP(3),
    "deposited_by_user_id" TEXT,
    "cleared_at" TIMESTAMP(3),
    "cleared_by_user_id" TEXT,
    "customer_payment_id" TEXT,
    "bounced_at" TIMESTAMP(3),
    "bounced_by_user_id" TEXT,
    "bounce_reason" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "cancelled_by_user_id" TEXT,
    "cancellation_reason" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "post_dated_cheques_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pdc_allocations" (
    "id" TEXT NOT NULL,
    "pdc_id" TEXT NOT NULL,
    "sales_invoice_id" TEXT NOT NULL,
    "amount_allocated" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pdc_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "post_dated_cheques_customer_payment_id_key" ON "post_dated_cheques"("customer_payment_id");

-- CreateIndex
CREATE INDEX "post_dated_cheques_organization_id_branch_id_status_idx" ON "post_dated_cheques"("organization_id", "branch_id", "status");

-- CreateIndex
CREATE INDEX "post_dated_cheques_organization_id_customer_id_idx" ON "post_dated_cheques"("organization_id", "customer_id");

-- CreateIndex
CREATE INDEX "post_dated_cheques_organization_id_cheque_date_idx" ON "post_dated_cheques"("organization_id", "cheque_date");

-- CreateIndex
CREATE INDEX "post_dated_cheques_cheque_number_idx" ON "post_dated_cheques"("cheque_number");

-- CreateIndex
CREATE UNIQUE INDEX "post_dated_cheques_organization_id_pdc_number_key" ON "post_dated_cheques"("organization_id", "pdc_number");

-- CreateIndex
CREATE INDEX "pdc_allocations_pdc_id_idx" ON "pdc_allocations"("pdc_id");

-- CreateIndex
CREATE INDEX "pdc_allocations_sales_invoice_id_idx" ON "pdc_allocations"("sales_invoice_id");

-- AddForeignKey
ALTER TABLE "post_dated_cheques" ADD CONSTRAINT "post_dated_cheques_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_dated_cheques" ADD CONSTRAINT "post_dated_cheques_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_dated_cheques" ADD CONSTRAINT "post_dated_cheques_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_dated_cheques" ADD CONSTRAINT "post_dated_cheques_customer_payment_id_fkey" FOREIGN KEY ("customer_payment_id") REFERENCES "customer_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_dated_cheques" ADD CONSTRAINT "post_dated_cheques_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_dated_cheques" ADD CONSTRAINT "post_dated_cheques_deposited_by_user_id_fkey" FOREIGN KEY ("deposited_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_dated_cheques" ADD CONSTRAINT "post_dated_cheques_cleared_by_user_id_fkey" FOREIGN KEY ("cleared_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_dated_cheques" ADD CONSTRAINT "post_dated_cheques_bounced_by_user_id_fkey" FOREIGN KEY ("bounced_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_dated_cheques" ADD CONSTRAINT "post_dated_cheques_cancelled_by_user_id_fkey" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pdc_allocations" ADD CONSTRAINT "pdc_allocations_pdc_id_fkey" FOREIGN KEY ("pdc_id") REFERENCES "post_dated_cheques"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pdc_allocations" ADD CONSTRAINT "pdc_allocations_sales_invoice_id_fkey" FOREIGN KEY ("sales_invoice_id") REFERENCES "sales_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
