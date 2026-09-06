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

  // Sales & Distribution (Foundational permissions for future module)
  {
    code: 'sales.view',
    description: 'View sales orders and invoices',
  },
  {
    code: 'sales.create',
    description: 'Create new sales orders and invoices',
  },
  {
    code: 'sales.edit',
    description: 'Edit draft sales orders and invoices',
  },
  {
    code: 'sales.cancel',
    description: 'Cancel or void sales transactions',
  },

  // Purchasing & Receiving (Foundational permissions for future module)
  {
    code: 'purchases.view',
    description: 'View purchase orders and goods receipts',
  },
  {
    code: 'purchases.create',
    description: 'Create purchase orders and record supplier receipts',
  },
  {
    code: 'purchases.edit',
    description: 'Edit draft purchase orders and receiving entries',
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

  // Payments & Cash Flow (Foundational permissions for future module)
  {
    code: 'payments.view',
    description: 'View customer and supplier payment records',
  },
  {
    code: 'payments.receive',
    description: 'Receive customer payments and record collections',
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
