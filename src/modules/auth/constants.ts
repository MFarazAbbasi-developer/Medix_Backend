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

  // Sales Returns
  {
    code: 'returns.view',
    description: 'View customer sales returns and credit notes',
  },
  {
    code: 'returns.create',
    description: 'Create and post customer sales returns and issue credit notes/refunds',
  },
  {
    code: 'returns.cancel',
    description: 'Cancel customer sales returns with stock and settlement reversal',
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
] as const;

export const PERMISSIONS_KEY = 'permissions';
