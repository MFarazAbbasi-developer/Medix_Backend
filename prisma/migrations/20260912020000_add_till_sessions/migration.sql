-- AlterEnum DocumentType
ALTER TYPE "DocumentType" ADD VALUE 'TILL_SESSION';

-- CreateEnum TillSessionStatus
CREATE TYPE "TillSessionStatus" AS ENUM ('OPEN', 'COUNTED', 'CLOSED');

-- CreateEnum TillMovementType
CREATE TYPE "TillMovementType" AS ENUM ('CASH_IN', 'CASH_OUT');

-- AlterTable SalesInvoicePayment
ALTER TABLE "sales_invoice_payments" ADD COLUMN "till_session_id" TEXT;

-- AlterTable CustomerPayment
ALTER TABLE "customer_payments" ADD COLUMN "till_session_id" TEXT;

-- AlterTable SalesReturn
ALTER TABLE "sales_returns" ADD COLUMN "till_session_id" TEXT;

-- CreateTable till_sessions
CREATE TABLE "till_sessions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "session_number" TEXT NOT NULL,
    "station_name" TEXT,
    "status" "TillSessionStatus" NOT NULL DEFAULT 'OPEN',
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "counted_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "opening_cash" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "cash_sales_amount" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "cash_payments_amount" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "cash_refunds_amount" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "cash_in_amount" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "cash_out_amount" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "expected_cash" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "actual_cash" DECIMAL(12,2),
    "variance_amount" DECIMAL(12,2),
    "card_sales_amount" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "bank_sales_amount" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "cheque_sales_amount" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "credit_sales_amount" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "variance_reason" TEXT,
    "notes" TEXT,
    "approved_by_user_id" TEXT,
    "closed_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "till_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable till_session_movements
CREATE TABLE "till_session_movements" (
    "id" TEXT NOT NULL,
    "till_session_id" TEXT NOT NULL,
    "movement_type" "TillMovementType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "reference_no" TEXT,
    "performed_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "till_session_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable till_session_denominations
CREATE TABLE "till_session_denominations" (
    "id" TEXT NOT NULL,
    "till_session_id" TEXT NOT NULL,
    "denomination_value" DECIMAL(12,2) NOT NULL,
    "note_count" INTEGER NOT NULL,
    "total_amount" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "till_session_denominations_pkey" PRIMARY KEY ("id")
);

-- Unique indexes
CREATE UNIQUE INDEX "till_sessions_organization_id_session_number_key" ON "till_sessions"("organization_id", "session_number");

-- Partial Unique Index for 1 Active Session per user per branch (OPEN or COUNTED)
CREATE UNIQUE INDEX "till_sessions_active_user_unique" ON "till_sessions"("organization_id", "branch_id", "user_id") WHERE "status" IN ('OPEN', 'COUNTED');

-- Indexes
CREATE INDEX "till_sessions_organization_id_branch_id_status_idx" ON "till_sessions"("organization_id", "branch_id", "status");
CREATE INDEX "till_sessions_organization_id_user_id_status_idx" ON "till_sessions"("organization_id", "user_id", "status");

CREATE INDEX "till_session_movements_till_session_id_idx" ON "till_session_movements"("till_session_id");
CREATE INDEX "till_session_denominations_till_session_id_idx" ON "till_session_denominations"("till_session_id");

CREATE INDEX "sales_invoice_payments_till_session_id_idx" ON "sales_invoice_payments"("till_session_id");
CREATE INDEX "customer_payments_till_session_id_idx" ON "customer_payments"("till_session_id");
CREATE INDEX "sales_returns_till_session_id_idx" ON "sales_returns"("till_session_id");

-- Foreign Keys
ALTER TABLE "till_sessions" ADD CONSTRAINT "till_sessions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "till_sessions" ADD CONSTRAINT "till_sessions_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "till_sessions" ADD CONSTRAINT "till_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "till_sessions" ADD CONSTRAINT "till_sessions_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "till_sessions" ADD CONSTRAINT "till_sessions_closed_by_user_id_fkey" FOREIGN KEY ("closed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "till_session_movements" ADD CONSTRAINT "till_session_movements_till_session_id_fkey" FOREIGN KEY ("till_session_id") REFERENCES "till_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "till_session_movements" ADD CONSTRAINT "till_session_movements_performed_by_id_fkey" FOREIGN KEY ("performed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "till_session_denominations" ADD CONSTRAINT "till_session_denominations_till_session_id_fkey" FOREIGN KEY ("till_session_id") REFERENCES "till_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "sales_invoice_payments" ADD CONSTRAINT "sales_invoice_payments_till_session_id_fkey" FOREIGN KEY ("till_session_id") REFERENCES "till_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_till_session_id_fkey" FOREIGN KEY ("till_session_id") REFERENCES "till_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_till_session_id_fkey" FOREIGN KEY ("till_session_id") REFERENCES "till_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
