-- CreateEnum
CREATE TYPE "ImportType" AS ENUM ('PRODUCTS', 'CUSTOMERS', 'SUPPLIERS', 'OPENING_STOCK', 'CUSTOMER_OPENING_BALANCES', 'SUPPLIER_OPENING_BALANCES');

-- CreateEnum
CREATE TYPE "ImportJobStatus" AS ENUM ('UPLOADED', 'VALIDATING', 'READY', 'IMPORTING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "import_jobs" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "type" "ImportType" NOT NULL,
    "status" "ImportJobStatus" NOT NULL DEFAULT 'UPLOADED',
    "original_filename" TEXT NOT NULL,
    "total_rows" INTEGER NOT NULL DEFAULT 0,
    "valid_rows" INTEGER NOT NULL DEFAULT 0,
    "invalid_rows" INTEGER NOT NULL DEFAULT 0,
    "imported_rows" INTEGER NOT NULL DEFAULT 0,
    "failed_rows" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB,

    CONSTRAINT "import_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "import_jobs_organization_id_type_idx" ON "import_jobs"("organization_id", "type");

-- CreateIndex
CREATE INDEX "import_jobs_organization_id_status_idx" ON "import_jobs"("organization_id", "status");

-- CreateIndex
CREATE INDEX "import_jobs_organization_id_created_at_idx" ON "import_jobs"("organization_id", "created_at");

-- AddForeignKey
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
