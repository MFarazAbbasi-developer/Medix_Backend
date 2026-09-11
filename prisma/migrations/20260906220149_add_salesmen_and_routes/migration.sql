-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "default_salesman_id" TEXT,
ADD COLUMN     "route_id" TEXT;

-- AlterTable
ALTER TABLE "sales_invoices" ADD COLUMN     "route_id" TEXT,
ADD COLUMN     "salesman_id" TEXT;

-- CreateTable
CREATE TABLE "salesmen" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "salesmen_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_routes" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT,
    "area" TEXT,
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "salesman_routes" (
    "salesman_id" TEXT NOT NULL,
    "route_id" TEXT NOT NULL,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "salesman_routes_pkey" PRIMARY KEY ("salesman_id","route_id")
);

-- CreateIndex
CREATE INDEX "salesmen_organization_id_branch_id_idx" ON "salesmen"("organization_id", "branch_id");

-- CreateIndex
CREATE INDEX "salesmen_organization_id_is_active_idx" ON "salesmen"("organization_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "salesmen_organization_id_code_key" ON "salesmen"("organization_id", "code");

-- CreateIndex
CREATE INDEX "sales_routes_organization_id_branch_id_idx" ON "sales_routes"("organization_id", "branch_id");

-- CreateIndex
CREATE INDEX "sales_routes_organization_id_is_active_idx" ON "sales_routes"("organization_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "sales_routes_organization_id_code_key" ON "sales_routes"("organization_id", "code");

-- CreateIndex
CREATE INDEX "salesman_routes_route_id_idx" ON "salesman_routes"("route_id");

-- CreateIndex
CREATE INDEX "customers_organization_id_default_salesman_id_idx" ON "customers"("organization_id", "default_salesman_id");

-- CreateIndex
CREATE INDEX "customers_organization_id_route_id_idx" ON "customers"("organization_id", "route_id");

-- CreateIndex
CREATE INDEX "sales_invoices_organization_id_salesman_id_idx" ON "sales_invoices"("organization_id", "salesman_id");

-- CreateIndex
CREATE INDEX "sales_invoices_organization_id_route_id_idx" ON "sales_invoices"("organization_id", "route_id");

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_default_salesman_id_fkey" FOREIGN KEY ("default_salesman_id") REFERENCES "salesmen"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "sales_routes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salesmen" ADD CONSTRAINT "salesmen_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salesmen" ADD CONSTRAINT "salesmen_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_routes" ADD CONSTRAINT "sales_routes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_routes" ADD CONSTRAINT "sales_routes_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salesman_routes" ADD CONSTRAINT "salesman_routes_salesman_id_fkey" FOREIGN KEY ("salesman_id") REFERENCES "salesmen"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salesman_routes" ADD CONSTRAINT "salesman_routes_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "sales_routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_salesman_id_fkey" FOREIGN KEY ("salesman_id") REFERENCES "salesmen"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "sales_routes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
