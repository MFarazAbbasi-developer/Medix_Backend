-- CreateEnum
CREATE TYPE "DeliveryOrderStatus" AS ENUM ('READY', 'PARTIALLY_DELIVERED', 'DELIVERED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "DocumentType" ADD VALUE 'DELIVERY_ORDER';

-- CreateTable
CREATE TABLE "delivery_orders" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "sales_invoice_id" TEXT NOT NULL,
    "do_number" TEXT NOT NULL,
    "status" "DeliveryOrderStatus" NOT NULL DEFAULT 'READY',
    "customer_id" TEXT NOT NULL,
    "invoice_number" TEXT NOT NULL,
    "invoice_date" TIMESTAMP(3) NOT NULL,
    "customer_name" TEXT NOT NULL,
    "customer_code" TEXT NOT NULL,
    "delivery_address_id" TEXT,
    "delivery_title" TEXT,
    "delivery_recipient" TEXT,
    "delivery_phone" TEXT,
    "delivery_address" TEXT,
    "delivery_city" TEXT,
    "delivery_instructions" TEXT,
    "salesman_id" TEXT,
    "salesman_name" TEXT,
    "salesman_code" TEXT,
    "route_id" TEXT,
    "route_name" TEXT,
    "route_code" TEXT,
    "notes" TEXT,
    "created_by_id" TEXT,
    "cancelled_by_id" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "cancellation_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_order_items" (
    "id" TEXT NOT NULL,
    "delivery_order_id" TEXT NOT NULL,
    "sales_invoice_item_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "batch_number" TEXT NOT NULL,
    "expiry_date" TIMESTAMP(3) NOT NULL,
    "product_name" TEXT NOT NULL,
    "product_sku" TEXT NOT NULL,
    "generic_name" TEXT,
    "unit_of_measurement" TEXT,
    "pack_size" TEXT,
    "ordered_billed_quantity" INTEGER NOT NULL,
    "ordered_bonus_quantity" INTEGER NOT NULL DEFAULT 0,
    "delivered_billed_quantity" INTEGER NOT NULL DEFAULT 0,
    "delivered_bonus_quantity" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "delivery_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_fulfillments" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "delivery_order_id" TEXT NOT NULL,
    "fulfillment_number" INTEGER NOT NULL,
    "fulfilled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fulfilled_by_id" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_fulfillments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_fulfillment_items" (
    "id" TEXT NOT NULL,
    "fulfillment_id" TEXT NOT NULL,
    "delivery_order_item_id" TEXT NOT NULL,
    "delivered_billed_quantity" INTEGER NOT NULL,
    "delivered_bonus_quantity" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "delivery_fulfillment_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "delivery_orders_sales_invoice_id_key" ON "delivery_orders"("sales_invoice_id");

-- CreateIndex
CREATE INDEX "delivery_orders_organization_id_branch_id_status_idx" ON "delivery_orders"("organization_id", "branch_id", "status");

-- CreateIndex
CREATE INDEX "delivery_orders_organization_id_customer_id_idx" ON "delivery_orders"("organization_id", "customer_id");

-- CreateIndex
CREATE INDEX "delivery_orders_organization_id_route_id_idx" ON "delivery_orders"("organization_id", "route_id");

-- CreateIndex
CREATE INDEX "delivery_orders_organization_id_salesman_id_idx" ON "delivery_orders"("organization_id", "salesman_id");

-- CreateIndex
CREATE INDEX "delivery_orders_sales_invoice_id_idx" ON "delivery_orders"("sales_invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_orders_organization_id_do_number_key" ON "delivery_orders"("organization_id", "do_number");

-- CreateIndex
CREATE INDEX "delivery_order_items_delivery_order_id_idx" ON "delivery_order_items"("delivery_order_id");

-- CreateIndex
CREATE INDEX "delivery_order_items_sales_invoice_item_id_idx" ON "delivery_order_items"("sales_invoice_item_id");

-- CreateIndex
CREATE INDEX "delivery_fulfillments_delivery_order_id_idx" ON "delivery_fulfillments"("delivery_order_id");

-- CreateIndex
CREATE INDEX "delivery_fulfillments_organization_id_idx" ON "delivery_fulfillments"("organization_id");

-- CreateIndex
CREATE INDEX "delivery_fulfillment_items_fulfillment_id_idx" ON "delivery_fulfillment_items"("fulfillment_id");

-- CreateIndex
CREATE INDEX "delivery_fulfillment_items_delivery_order_item_id_idx" ON "delivery_fulfillment_items"("delivery_order_item_id");

-- AddForeignKey
ALTER TABLE "delivery_orders" ADD CONSTRAINT "delivery_orders_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_orders" ADD CONSTRAINT "delivery_orders_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_orders" ADD CONSTRAINT "delivery_orders_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_orders" ADD CONSTRAINT "delivery_orders_sales_invoice_id_fkey" FOREIGN KEY ("sales_invoice_id") REFERENCES "sales_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_orders" ADD CONSTRAINT "delivery_orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_orders" ADD CONSTRAINT "delivery_orders_salesman_id_fkey" FOREIGN KEY ("salesman_id") REFERENCES "salesmen"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_orders" ADD CONSTRAINT "delivery_orders_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "sales_routes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_orders" ADD CONSTRAINT "delivery_orders_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_orders" ADD CONSTRAINT "delivery_orders_cancelled_by_id_fkey" FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_order_items" ADD CONSTRAINT "delivery_order_items_delivery_order_id_fkey" FOREIGN KEY ("delivery_order_id") REFERENCES "delivery_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_order_items" ADD CONSTRAINT "delivery_order_items_sales_invoice_item_id_fkey" FOREIGN KEY ("sales_invoice_item_id") REFERENCES "sales_invoice_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_order_items" ADD CONSTRAINT "delivery_order_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_order_items" ADD CONSTRAINT "delivery_order_items_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_fulfillments" ADD CONSTRAINT "delivery_fulfillments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_fulfillments" ADD CONSTRAINT "delivery_fulfillments_delivery_order_id_fkey" FOREIGN KEY ("delivery_order_id") REFERENCES "delivery_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_fulfillments" ADD CONSTRAINT "delivery_fulfillments_fulfilled_by_id_fkey" FOREIGN KEY ("fulfilled_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_fulfillment_items" ADD CONSTRAINT "delivery_fulfillment_items_fulfillment_id_fkey" FOREIGN KEY ("fulfillment_id") REFERENCES "delivery_fulfillments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_fulfillment_items" ADD CONSTRAINT "delivery_fulfillment_items_delivery_order_item_id_fkey" FOREIGN KEY ("delivery_order_item_id") REFERENCES "delivery_order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
