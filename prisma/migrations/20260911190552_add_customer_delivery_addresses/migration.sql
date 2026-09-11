-- AlterTable
ALTER TABLE "sales_invoices" ADD COLUMN     "delivery_address" TEXT,
ADD COLUMN     "delivery_address_id" TEXT,
ADD COLUMN     "delivery_city" TEXT,
ADD COLUMN     "delivery_instructions" TEXT,
ADD COLUMN     "delivery_phone" TEXT,
ADD COLUMN     "delivery_recipient" TEXT,
ADD COLUMN     "delivery_title" TEXT;

-- CreateTable
CREATE TABLE "customer_delivery_addresses" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "recipient_name" TEXT,
    "phone" TEXT,
    "address" TEXT NOT NULL,
    "city" TEXT,
    "route_id" TEXT,
    "delivery_instructions" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_delivery_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_delivery_addresses_organization_id_customer_id_idx" ON "customer_delivery_addresses"("organization_id", "customer_id");

-- CreateIndex
CREATE INDEX "customer_delivery_addresses_organization_id_is_active_idx" ON "customer_delivery_addresses"("organization_id", "is_active");

-- CreateIndex
CREATE INDEX "customer_delivery_addresses_route_id_idx" ON "customer_delivery_addresses"("route_id");

-- CreateIndex
CREATE INDEX "sales_invoices_organization_id_delivery_address_id_idx" ON "sales_invoices"("organization_id", "delivery_address_id");

-- CreatePartialUniqueIndex (At most one default address per customer)
CREATE UNIQUE INDEX "customer_delivery_addresses_customer_id_is_default_unique" ON "customer_delivery_addresses"("customer_id") WHERE "is_default" = true;

-- AddForeignKey
ALTER TABLE "customer_delivery_addresses" ADD CONSTRAINT "customer_delivery_addresses_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_delivery_addresses" ADD CONSTRAINT "customer_delivery_addresses_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_delivery_addresses" ADD CONSTRAINT "customer_delivery_addresses_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "sales_routes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_delivery_address_id_fkey" FOREIGN KEY ("delivery_address_id") REFERENCES "customer_delivery_addresses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
