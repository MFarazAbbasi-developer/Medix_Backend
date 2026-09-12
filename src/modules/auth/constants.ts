export const ROLE_ADMIN = 'ADMIN';

export const INITIAL_PERMISSIONS = [
  // Dashboard
  {
    code: 'dashboard.view',
    description: 'View dashboard and station overview',
  },

  // User Management
  {
    code: 'users.view',
    description: 'View user accounts and access profiles',
  },
  {
    code: 'users.create',
    description: 'Create new system user accounts',
  },
  {
    code: 'users.edit',
    description: 'Edit existing user accounts and role assignments',
  },
  {
    code: 'users.disable',
    description: 'Disable or deactivate user accounts',
  },
  {
    code: 'users.manage',
    description: 'Create, edit, deactivate, and reset user passwords',
  },

  // Role & Permission Management
  {
    code: 'roles.view',
    description: 'View system roles and permission assignments',
  },
  {
    code: 'roles.manage',
    description: 'Create, edit, and configure roles and permissions',
  },

  // Settings & Station Configuration
  {
    code: 'settings.view',
    description: 'View system and station settings',
  },
  {
    code: 'settings.manage',
    description: 'Modify system and station configuration',
  },

  // Products & Catalog
  {
    code: 'products.view',
    description: 'View pharmaceutical product catalog and specifications',
  },
  {
    code: 'products.create',
    description: 'Create new pharmaceutical products and SKUs',
  },
  {
    code: 'products.edit',
    description: 'Edit pharmaceutical product specifications and pricing',
  },
  {
    code: 'products.disable',
    description: 'Activate or deactivate pharmaceutical products',
  },

  // Batches & Lot Management
  {
    code: 'batches.view',
    description: 'View product batches, expiry dates, and lot pricing',
  },
  {
    code: 'batches.create',
    description: 'Register new product manufacturing batches',
  },
  {
    code: 'batches.edit',
    description: 'Update batch pricing, status, and remarks',
  },

  // Customers & Clients
  {
    code: 'customers.view',
    description: 'View customer profiles and directory',
  },
  {
    code: 'customers.create',
    description: 'Create new customer master records',
  },
  {
    code: 'customers.edit',
    description: 'Edit customer specifications, licenses, and credit terms',
  },
  {
    code: 'customers.ledger_view',
    description: 'View customer sub-ledger statements and receivable balances',
  },

  // Sales & Dispensing
  {
    code: 'sales.view',
    description: 'View sales orders and invoices',
  },
  {
    code: 'sales.create',
    description: 'Create and post new sales invoices',
  },
  {
    code: 'sales.edit',
    description: 'Edit draft sales orders and invoices',
  },
  {
    code: 'sales.cancel',
    description: 'Cancel or void posted sales invoices with stock and ledger reversal',
  },
  {
    code: 'sales.view_cost_margin',
    description: 'View COGS cost price and gross profit margin on invoices',
  },
  {
    code: 'sales.override_mrp',
    description: 'Override Maximum Retail Price (MRP) ceiling on sales invoices with justification reason',
  },

  // Suppliers & Vendors
  {
    code: 'suppliers.view',
    description: 'View supplier profiles and vendor directory',
  },
  {
    code: 'suppliers.create',
    description: 'Create new supplier master records',
  },
  {
    code: 'suppliers.edit',
    description: 'Edit supplier specifications and credit terms',
  },
  {
    code: 'suppliers.ledger_view',
    description: 'View supplier sub-ledger statements and payable balances',
  },

  // Purchasing & Receiving
  {
    code: 'purchases.view',
    description: 'View purchase orders and goods receive notes',
  },
  {
    code: 'purchases.create',
    description: 'Create purchase orders and draft goods receive notes',
  },
  {
    code: 'purchases.edit',
    description: 'Edit draft purchase orders and goods receive notes',
  },
  {
    code: 'purchases.post_grn',
    description: 'Post goods receive notes and receive stock into inventory',
  },
  {
    code: 'purchases.cancel',
    description: 'Cancel purchase orders or draft goods receive notes',
  },

  // Inventory Management
  {
    code: 'inventory.view',
    description: 'View inventory stock levels and batch balances',
  },
  {
    code: 'inventory.ledger_view',
    description: 'View chronological stock movement ledger and history',
  },
  {
    code: 'inventory.adjust',
    description: 'Create and post inventory stock adjustments and corrections',
  },

  // Warehouses & Storage Locations
  {
    code: 'warehouses.view',
    description: 'View warehouse and storage locations',
  },
  {
    code: 'warehouses.manage',
    description: 'Create and edit warehouse and storage locations',
  },

  // Payments & Cash Flow
  {
    code: 'payments.view',
    description: 'View customer and supplier payment records and vouchers',
  },
  {
    code: 'payments.create',
    description: 'Create and post customer payment receipts and invoice settlements',
  },
  {
    code: 'payments.cancel',
    description: 'Cancel or void customer payment receipts with settlement restoration',
  },
  {
    code: 'payments.receive',
    description: 'Receive customer payments and record collections',
  },

  // Post-Dated Cheques (PDC - Phase 20E)
  {
    code: 'payments.pdc.view',
    description: 'View post-dated cheque register, status history, and custody receipts',
  },
  {
    code: 'payments.pdc.create',
    description: 'Receive and register post-dated cheques with pre-allocation intent',
  },
  {
    code: 'payments.pdc.deposit',
    description: 'Record bank deposit details for post-dated cheques',
  },
  {
    code: 'payments.pdc.clear',
    description: 'Execute bank clearance and generate authoritative customer payment receipt',
  },
  {
    code: 'payments.pdc.bounce',
    description: 'Mark post-dated cheques as bounced/dishonored by bank',
  },
  {
    code: 'payments.pdc.cancel',
    description: 'Cancel or return post-dated cheques to customer prior to clearance',
  },

  // Sales & Purchase Returns (Phase 20H)
  {
    code: 'returns.view',
    description: 'View customer sales returns, purchase returns, and credit/debit notes',
  },
  {
    code: 'returns.create',
    description: 'Create sales returns, credit notes, and draft purchase returns',
  },
  {
    code: 'returns.cancel',
    description: 'Cancel sales returns and purchase returns with stock and settlement reversal',
  },
  {
    code: 'returns.dispatch_challan',
    description: 'Dispatch purchase return goods and generate non-financial supplier return challan',
  },
  {
    code: 'returns.post_debit_note',
    description: 'Finalize and post purchase return debit note to supplier ledger',
  },
  {
    code: 'returns.rga_manage',
    description: 'Register and update Return Goods Authorization (RGA/RMA) reference numbers',
  },
  {
    code: 'returns.print_challan',
    description: 'Print supplier return transport delivery challans (A4 & 80mm)',
  },

  // Pricing & Commercial Schemes
  {
    code: 'pricing.view',
    description: 'View customer pricing rules and commercial contracts',
  },
  {
    code: 'pricing.manage',
    description: 'Create, edit, and deactivate pricing rules and overrides',
  },
  {
    code: 'schemes.view',
    description: 'View promotional schemes and bonus policies',
  },
  {
    code: 'schemes.manage',
    description: 'Create, edit, and deactivate promotional schemes',
  },
  {
    code: 'sales.override_discount',
    description: 'Manually override automated pricing and discounts on sales invoices',
  },

  // Stock Transfers
  {
    code: 'transfers.view',
    description: 'View warehouse stock transfers and in-transit records',
  },
  {
    code: 'transfers.manage',
    description: 'Create and edit draft stock transfers',
  },
  {
    code: 'transfers.dispatch',
    description: 'Dispatch stock transfers and release inventory into transit',
  },
  {
    code: 'transfers.receive',
    description: 'Receive and verify stock transfers into destination warehouses',
  },
  {
    code: 'transfers.cancel',
    description: 'Cancel stock transfers with automated stock reversal',
  },

  // Expiry Management
  {
    code: 'expiry.view',
    description: 'View expiry metrics, aging thresholds, and expired stock reports',
  },
  {
    code: 'expiry.manage',
    description: 'Configure expiry thresholds and manage near-expiry stock',
  },

  // Quarantine Operations
  {
    code: 'quarantine.view',
    description: 'View quarantined stock and quarantine warehouse inventory',
  },
  {
    code: 'quarantine.manage',
    description: 'Quarantine inventory and release approved stock back to standard inventory',
  },

  // Product Recalls
  {
    code: 'recalls.view',
    description: 'View product recalls, affected batches, and impacted warehouses',
  },
  {
    code: 'recalls.manage',
    description: 'Initiate, update, quarantine, and cancel product recalls',
  },

  // Reporting & Audit
  {
    code: 'reports.view',
    description: 'View business performance, sales, and inventory reports',
  },
  {
    code: 'audit.view',
    description: 'View system audit trail and activity logs',
  },

  // Database Backup & Restore
  {
    code: 'backup.view',
    description: 'View database backup history and status',
  },
  {
    code: 'backup.manage',
    description: 'Create manual database backups',
  },
  {
    code: 'backup.restore',
    description: 'Execute database restore operations (destructive)',
  },

  // Data Export
  {
    code: 'data.export',
    description: 'Export master and transactional data to CSV',
  },

  // Data Imports Engine
  {
    code: 'imports.view',
    description: 'View imports history, preview uploaded files, templates, and error reports',
  },
  {
    code: 'imports.manage',
    description: 'Upload files, confirm/execute data imports, and cancel jobs',
  },

  // Delivery Orders & Fulfillment (Phase 20C)
  {
    code: 'delivery_orders.view',
    description: 'View delivery orders and fulfillment history',
  },
  {
    code: 'delivery_orders.create',
    description: 'Create delivery orders from posted sales invoices',
  },
  {
    code: 'delivery_orders.fulfill',
    description: 'Record partial and full fulfillment events on delivery orders',
  },
  {
    code: 'delivery_orders.cancel',
    description: 'Cancel unfulfilled delivery orders',
  },
  {
    code: 'delivery_orders.print',
    description: 'Print delivery challans and dispatch notes',
  },

  // Cash Sessions & Till Reconciliation (Phase 20F)
  {
    code: 'cash_sessions.view',
    description: 'View till sessions, register, and daily cash reconciliation',
  },
  {
    code: 'cash_sessions.open',
    description: 'Open a new cash till session with opening float',
  },
  {
    code: 'cash_sessions.count',
    description: 'Count physical drawer cash and calculate variance',
  },
  {
    code: 'cash_sessions.close',
    description: 'Close and finalize active till session',
  },
  {
    code: 'cash_sessions.adjust',
    description: 'Record intra-day cash-in (float add) and cash-out (safe drop/petty) movements',
  },
  {
    code: 'cash_sessions.approve_variance',
    description: 'Approve till session closing with cash shortage or excess above threshold',
  },
  {
    code: 'cash_sessions.print',
    description: 'Print 80mm till close slips and daily reconciliation reports',
  },

  // Reorder Point & Purchase Suggestions (Phase 20G)
  {
    code: 'purchases.suggestions_view',
    description: 'View reorder points, sales velocity, and purchase suggestions',
  },
  {
    code: 'purchases.suggestions_configure',
    description: 'Configure branch product reorder points, target stock, and lead times',
  },
] as const;

export const PERMISSIONS_KEY = 'permissions';
