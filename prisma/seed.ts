import {
  PrismaClient,
  UserStatus,
  DocumentType,
  SettingDataType,
  BatchStatus,
  WarehouseType,
  StockMovementType,
  CustomerType,
  SchemeType,
  PaymentMethod,
  GrnStatus,
  SupplierLedgerEntryType,
  SalesInvoiceStatus,
  CustomerLedgerEntryType,
  CustomerPaymentStatus,
  StockTransferStatus,
  RecallSeverity,
  RecallStatus,
} from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  });
}

async function main() {
  console.log('🌱 Starting Medix by FARMAX comprehensive database seeding...');

  // =========================================================================
  // 1. ORGANIZATION & BRANCHES
  // =========================================================================
  console.log('📦 Seeding Organization and Branches...');
  let org = await prisma.organization.findFirst();
  if (!org) {
    org = await prisma.organization.create({
      data: {
        name: 'Medix Pharma Distribution',
        legalName: 'Medix Pharma Distribution (Pvt) Ltd',
        country: 'Pakistan',
        city: 'Karachi',
        state: 'Sindh',
        address: 'Main Distribution Hub, Sector 15, Korangi Industrial Area',
        phone: '+92-21-35000000',
        email: 'info@medixpharma.pk',
        website: 'https://medixpharma.pk',
        ntn: '7100234-5',
        strn: '17-00-7100-234-11',
        drugSaleLicenseNo: 'DSL-KHI-2026-894',
      },
    });
  }

  // Branch 1: Head Office
  let hoBranch = await prisma.branch.findUnique({
    where: { organizationId_code: { organizationId: org.id, code: 'HO' } },
  });
  if (!hoBranch) {
    hoBranch = await prisma.branch.create({
      data: {
        organizationId: org.id,
        name: 'Head Office & Central Warehouse',
        code: 'HO',
        isHeadOffice: true,
        isActive: true,
        city: 'Karachi',
        address: 'Plot # 45-B, Commercial Area, Karachi',
        phone: '+92-21-35000001',
        email: 'headoffice@medixpharma.pk',
      },
    });
  }

  // Branch 2: Lahore Regional Branch
  let lhrBranch = await prisma.branch.findUnique({
    where: { organizationId_code: { organizationId: org.id, code: 'BR-LHR' } },
  });
  if (!lhrBranch) {
    lhrBranch = await prisma.branch.create({
      data: {
        organizationId: org.id,
        name: 'Lahore Regional Distribution Hub',
        code: 'BR-LHR',
        isHeadOffice: false,
        isActive: true,
        city: 'Lahore',
        address: 'Ferozepur Road, Industrial Area, Lahore',
        phone: '+92-42-35900001',
        email: 'lahore@medixpharma.pk',
      },
    });
  }

  // =========================================================================
  // 2. WAREHOUSES
  // =========================================================================
  console.log('🏭 Seeding Warehouses...');
  const warehouseData = [
    {
      branchId: hoBranch.id,
      name: 'Main Distribution Warehouse',
      code: 'WH-MAIN',
      warehouseType: WarehouseType.STANDARD,
      isDefault: true,
    },
    {
      branchId: hoBranch.id,
      name: 'Quarantine & Damaged Hold',
      code: 'WH-QUAR',
      warehouseType: WarehouseType.QUARANTINE,
      isDefault: false,
    },
    {
      branchId: hoBranch.id,
      name: 'Dispensary & Fast-Moving Rack',
      code: 'WH-DISP',
      warehouseType: WarehouseType.STANDARD,
      isDefault: false,
    },
    {
      branchId: hoBranch.id,
      name: 'Cold-Chain Vaccines & Biologics Unit',
      code: 'WH-COLD',
      warehouseType: WarehouseType.STANDARD,
      isDefault: false,
    },
    {
      branchId: lhrBranch.id,
      name: 'Lahore Central Warehouse',
      code: 'WH-LHR-MAIN',
      warehouseType: WarehouseType.STANDARD,
      isDefault: true,
    },
  ];

  const warehouses: Record<string, string> = {};
  for (const w of warehouseData) {
    const wh = await prisma.warehouse.upsert({
      where: { branchId_code: { branchId: w.branchId, code: w.code } },
      update: { name: w.name, warehouseType: w.warehouseType, isDefault: w.isDefault },
      create: {
        organizationId: org.id,
        branchId: w.branchId,
        name: w.name,
        code: w.code,
        warehouseType: w.warehouseType,
        isDefault: w.isDefault,
        isActive: true,
      },
    });
    warehouses[w.code] = wh.id;
  }

  // =========================================================================
  // 3. NUMBERING SERIES
  // =========================================================================
  console.log('🔢 Seeding Numbering Series...');
  const defaultSeriesList = [
    { documentType: DocumentType.SALES_INVOICE, prefix: 'INV-', padding: 5 },
    { documentType: DocumentType.PURCHASE_INVOICE, prefix: 'PINV-', padding: 5 },
    { documentType: DocumentType.PURCHASE_ORDER, prefix: 'PO-', padding: 5 },
    { documentType: DocumentType.SALES_RETURN, prefix: 'SRET-', padding: 5 },
    { documentType: DocumentType.PURCHASE_RETURN, prefix: 'PRET-', padding: 5 },
    { documentType: DocumentType.PAYMENT_RECEIPT, prefix: 'REC-', padding: 5 },
    { documentType: DocumentType.GOODS_RECEIVE_NOTE, prefix: 'GRN-', padding: 5 },
    { documentType: DocumentType.STOCK_ADJUSTMENT, prefix: 'ADJ-', padding: 5 },
    { documentType: DocumentType.STOCK_TRANSFER, prefix: 'TRF-', padding: 5 },
    { documentType: DocumentType.PRODUCT_RECALL, prefix: 'RCL-', padding: 5 },
  ];

  for (const item of defaultSeriesList) {
    const existing = await prisma.numberingSeries.findFirst({
      where: {
        organizationId: org.id,
        branchId: null,
        documentType: item.documentType,
      },
    });

    if (!existing) {
      await prisma.numberingSeries.create({
        data: {
          organizationId: org.id,
          branchId: null,
          documentType: item.documentType,
          prefix: item.prefix,
          nextNumber: 10,
          padding: item.padding,
          isActive: true,
        },
      });
    }
  }

  // =========================================================================
  // 4. SYSTEM SETTINGS
  // =========================================================================
  console.log('⚙️ Seeding System Settings...');
  const defaultSettings = [
    { key: 'currency', value: 'PKR', dataType: SettingDataType.STRING, group: 'GENERAL', description: 'Operating currency code' },
    { key: 'currencySymbol', value: 'Rs.', dataType: SettingDataType.STRING, group: 'GENERAL', description: 'Currency display symbol' },
    { key: 'dateFormat', value: 'YYYY-MM-DD', dataType: SettingDataType.STRING, group: 'GENERAL', description: 'Standard date format' },
    { key: 'timeZone', value: 'Asia/Karachi', dataType: SettingDataType.STRING, group: 'GENERAL', description: 'Pakistan Standard Time (UTC+5)' },
    { key: 'defaultTaxRate', value: '0', dataType: SettingDataType.NUMBER, group: 'TAX', description: 'Default sales tax rate %' },
    { key: 'invoiceFooterNote', value: 'Warranty under Drug Act 1976. Goods once sold will not be returned without original cash receipt.', dataType: SettingDataType.STRING, group: 'INVOICE', description: 'Legal footer disclaimer' },
    { key: 'defaultBranchId', value: hoBranch.id, dataType: SettingDataType.STRING, group: 'GENERAL', description: 'Default active branch' },
    { key: 'allowNegativeStock', value: 'false', dataType: SettingDataType.BOOLEAN, group: 'INVENTORY', description: 'Enforce strict non-negative inventory' },
    { key: 'DEFAULT_SALES_PRICING_BASE', value: 'TP', dataType: SettingDataType.STRING, group: 'SALES', description: 'Default pricing base (TP/MRP)' },
  ];

  for (const s of defaultSettings) {
    await prisma.systemSetting.upsert({
      where: { organizationId_key: { organizationId: org.id, key: s.key } },
      update: { value: s.value },
      create: {
        organizationId: org.id,
        key: s.key,
        value: s.value,
        dataType: s.dataType,
        group: s.group,
        description: s.description,
      },
    });
  }

  // =========================================================================
  // 5. RBAC PERMISSIONS, ROLES & DEMO USERS
  // =========================================================================
  console.log('🔐 Seeding Roles, Permissions, and Demo Users...');
  const permissionsList = [
    { code: 'inventory.view', description: 'View stock levels, batches, and movements' },
    { code: 'inventory.adjust', description: 'Create and post stock adjustments' },
    { code: 'inventory.transfer', description: 'Dispatch and receive stock transfers' },
    { code: 'purchasing.view', description: 'View purchase orders and GRNs' },
    { code: 'purchasing.create', description: 'Create purchase orders and draft GRNs' },
    { code: 'purchasing.post', description: 'Post GRNs and affect stock/payable ledgers' },
    { code: 'sales.view', description: 'View sales invoices and drafts' },
    { code: 'sales.create', description: 'Create sales invoice drafts' },
    { code: 'sales.post', description: 'Finalize and post sales invoices' },
    { code: 'sales.cancel', description: 'Cancel posted sales invoices' },
    { code: 'returns.view', description: 'View sales and purchase returns' },
    { code: 'returns.manage', description: 'Create and post returns' },
    { code: 'payments.view', description: 'View customer and supplier payment vouchers' },
    { code: 'payments.manage', description: 'Record and allocate payments' },
    { code: 'expiry.view', description: 'View expiry dashboard and aging alerts' },
    { code: 'expiry.quarantine', description: 'Move batches to quarantine' },
    { code: 'recalls.manage', description: 'Initiate and manage product batch recalls' },
    { code: 'reports.view', description: 'View operational analytics and registers' },
    { code: 'reports.export', description: 'Export business reports and datasets' },
    { code: 'users.view', description: 'View user directory and profiles' },
    { code: 'users.manage', description: 'Create, update, activate/deactivate users' },
    { code: 'roles.manage', description: 'Configure roles and permission matrices' },
    { code: 'system.backup', description: 'Create, verify, and restore database backups' },
    { code: 'masterdata.manage', description: 'Manage products, batches, suppliers, and customers' },
  ];

  for (const p of permissionsList) {
    await prisma.permission.upsert({
      where: { code: p.code },
      update: { description: p.description },
      create: { code: p.code, description: p.description },
    });
  }

  const allPerms = await prisma.permission.findMany();

  // Roles
  const adminRole = await prisma.role.upsert({
    where: { name: 'ADMIN' },
    update: { description: 'Full system administrator with unrestricted access' },
    create: { name: 'ADMIN', description: 'Full system administrator with unrestricted access' },
  });

  const pharmacistRole = await prisma.role.upsert({
    where: { name: 'PHARMACIST' },
    update: { description: 'Chief Pharmacist & Inventory Lead' },
    create: { name: 'PHARMACIST', description: 'Chief Pharmacist & Inventory Lead' },
  });

  const cashierRole = await prisma.role.upsert({
    where: { name: 'CASHIER' },
    update: { description: 'Cashier & POS Billing Specialist' },
    create: { name: 'CASHIER', description: 'Cashier & POS Billing Specialist' },
  });

  // Link permissions to ADMIN
  for (const perm of allPerms) {
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: adminRole.id, permissionId: perm.id } },
      update: {},
      create: { roleId: adminRole.id, permissionId: perm.id },
    });
  }

  // Link permissions to PHARMACIST (Inventory, Purchasing, Sales, Expiry, Recalls, Reports)
  const pharmacistPermCodes = [
    'inventory.view', 'inventory.adjust', 'inventory.transfer',
    'purchasing.view', 'purchasing.create', 'purchasing.post',
    'sales.view', 'sales.create', 'sales.post',
    'returns.view', 'returns.manage',
    'expiry.view', 'expiry.quarantine', 'recalls.manage',
    'reports.view', 'reports.export', 'masterdata.manage',
  ];
  for (const perm of allPerms.filter(p => pharmacistPermCodes.includes(p.code))) {
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: pharmacistRole.id, permissionId: perm.id } },
      update: {},
      create: { roleId: pharmacistRole.id, permissionId: perm.id },
    });
  }

  // Link permissions to CASHIER (Sales, Returns, Customer Payments)
  const cashierPermCodes = [
    'inventory.view',
    'sales.view', 'sales.create', 'sales.post',
    'returns.view', 'returns.manage',
    'payments.view', 'payments.manage',
    'reports.view',
  ];
  for (const perm of allPerms.filter(p => cashierPermCodes.includes(p.code))) {
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: cashierRole.id, permissionId: perm.id } },
      update: {},
      create: { roleId: cashierRole.id, permissionId: perm.id },
    });
  }

  // Users
  const adminPasswordHash = await hashPassword('AdminPassword123!');
  const staffPasswordHash = await hashPassword('Medix@2026');

  // Admin user
  const adminUser = await prisma.user.upsert({
    where: { username: 'admin' },
    update: { passwordHash: adminPasswordHash, status: UserStatus.ACTIVE },
    create: {
      username: 'admin',
      displayName: 'System Administrator',
      passwordHash: adminPasswordHash,
      status: UserStatus.ACTIVE,
    },
  });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: adminUser.id, roleId: adminRole.id } },
    update: {},
    create: { userId: adminUser.id, roleId: adminRole.id },
  });

  // Pharmacist user
  const pharmacistUser = await prisma.user.upsert({
    where: { username: 'pharmacist' },
    update: { passwordHash: staffPasswordHash, status: UserStatus.ACTIVE },
    create: {
      username: 'pharmacist',
      displayName: 'Dr. Tariq Mahmood (Chief Pharmacist)',
      passwordHash: staffPasswordHash,
      status: UserStatus.ACTIVE,
    },
  });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: pharmacistUser.id, roleId: pharmacistRole.id } },
    update: {},
    create: { userId: pharmacistUser.id, roleId: pharmacistRole.id },
  });

  // Cashier user
  const cashierUser = await prisma.user.upsert({
    where: { username: 'cashier' },
    update: { passwordHash: staffPasswordHash, status: UserStatus.ACTIVE },
    create: {
      username: 'cashier',
      displayName: 'Ayesha Khan (Billing Desk)',
      passwordHash: staffPasswordHash,
      status: UserStatus.ACTIVE,
    },
  });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: cashierUser.id, roleId: cashierRole.id } },
    update: {},
    create: { userId: cashierUser.id, roleId: cashierRole.id },
  });

  // =========================================================================
  // 6. UNITS OF MEASUREMENT & PRODUCT CATEGORIES
  // =========================================================================
  console.log('🏷️ Seeding Units of Measurement & Categories...');
  const unitsList = [
    { name: 'Box', symbol: 'Box' },
    { name: 'Strip', symbol: 'Strip' },
    { name: 'Bottle', symbol: 'Btl' },
    { name: 'Ampoule', symbol: 'Amp' },
    { name: 'Vial', symbol: 'Vial' },
    { name: 'Syringe', symbol: 'Syr' },
    { name: 'Tube', symbol: 'Tube' },
    { name: 'Sachet', symbol: 'Sach' },
    { name: 'Drops Bottle', symbol: 'Drp' },
    { name: 'Packet', symbol: 'Pkt' },
  ];

  const units: Record<string, string> = {};
  for (const u of unitsList) {
    const unit = await prisma.unitOfMeasurement.upsert({
      where: { organizationId_symbol: { organizationId: org.id, symbol: u.symbol } },
      update: { name: u.name },
      create: { organizationId: org.id, name: u.name, symbol: u.symbol, isActive: true },
    });
    units[u.symbol] = unit.id;
  }

  const categoriesList = [
    { name: 'Antibiotics', code: 'CAT-ANTI', description: 'Broad spectrum & targeted antibacterial medicines' },
    { name: 'Analgesics & Antipyretics', code: 'CAT-ANAL', description: 'Pain relief and fever reduction' },
    { name: 'Cardiovascular', code: 'CAT-CARD', description: 'Blood pressure and cardiac medications' },
    { name: 'Gastrointestinal', code: 'CAT-GAST', description: 'Antacids, PPIs, anti-emetics' },
    { name: 'Respiratory & Anti-Allergic', code: 'CAT-RESP', description: 'Antihistamines, cough syrups, bronchodilators' },
    { name: 'Nutritional & Vitamins', code: 'CAT-VIT', description: 'Essential vitamins, minerals, and supplements' },
    { name: 'Dermatological', code: 'CAT-DERM', description: 'Topical creams, ointments, skin therapies' },
    { name: 'Medical Devices & Surgical', code: 'CAT-SURG', description: 'Surgical disposables, syringes, cannulas' },
  ];

  const categories: Record<string, string> = {};
  for (const c of categoriesList) {
    const cat = await prisma.productCategory.upsert({
      where: { organizationId_name: { organizationId: org.id, name: c.name } },
      update: { code: c.code, description: c.description },
      create: { organizationId: org.id, name: c.name, code: c.code, description: c.description, isActive: true },
    });
    categories[c.name] = cat.id;
  }

  // =========================================================================
  // 7. MANUFACTURERS
  // =========================================================================
  console.log('🏭 Seeding Pharmaceutical Manufacturers...');
  const manufacturersList = [
    { name: 'GSK Pakistan', code: 'MFG-GSK', contactPerson: 'Asim Raza', phone: '+92-21-111475725', email: 'orders@gsk.pk', address: 'F-268, S.I.T.E., Karachi' },
    { name: 'Getz Pharma', code: 'MFG-GETZ', contactPerson: 'Farhan Siddiqui', phone: '+92-21-38670000', email: 'sales@getzpharma.com', address: 'Plot 29-30/27, Korangi Industrial Area, Karachi' },
    { name: 'Abbott Laboratories', code: 'MFG-ABT', contactPerson: 'Khurram Shehzad', phone: '+92-21-111222688', email: 'supply@abbott.pk', address: 'Opposite Radio Pakistan, Hyderabad Road, Landhi, Karachi' },
    { name: 'The Searle Company', code: 'MFG-SRL', contactPerson: 'M. Nadeem', phone: '+92-21-35050014', email: 'info@searlecompany.com', address: '1st Floor, N.I.C.L. Building, Abbasi Shaheed Road, Karachi' },
    { name: 'Sanofi-Aventis Pakistan', code: 'MFG-SNF', contactPerson: 'Zubair Ahmed', phone: '+92-21-35060221', email: 'pakistan.orders@sanofi.com', address: 'Plot 23, Sector 22, Korangi Industrial Area, Karachi' },
  ];

  const manufacturers: Record<string, string> = {};
  for (const m of manufacturersList) {
    const mfg = await prisma.manufacturer.upsert({
      where: { organizationId_name: { organizationId: org.id, name: m.name } },
      update: { code: m.code, contactPerson: m.contactPerson, phone: m.phone, email: m.email, address: m.address },
      create: { organizationId: org.id, name: m.name, code: m.code, contactPerson: m.contactPerson, phone: m.phone, email: m.email, address: m.address, isActive: true },
    });
    manufacturers[m.name] = mfg.id;
  }

  // =========================================================================
  // 8. SUPPLIERS
  // =========================================================================
  console.log('🚚 Seeding Suppliers...');
  const suppliersList = [
    {
      code: 'SUP-001',
      name: 'Getz Pharma Distribution Network',
      contactPerson: 'Zainab Fatima',
      phone: '+92-21-35012345',
      email: 'distribution@getz.pk',
      address: 'Plot 31, Korangi Industrial Zone, Karachi',
      city: 'Karachi',
      ntn: '1209384-1',
      strn: '17-00-1209-384-11',
      drugLicenseNo: 'DSL-DIST-2025-001',
      creditDays: 30,
      creditLimit: 1500000.0,
      currentBalance: 85400.0,
    },
    {
      code: 'SUP-002',
      name: 'GSK Pakistan Distribution Hub',
      contactPerson: 'Bilal Warraich',
      phone: '+92-21-32567890',
      email: 'orders@gskdist.pk',
      address: 'S.I.T.E. Industrial Area, Karachi',
      city: 'Karachi',
      ntn: '0812345-6',
      strn: '17-00-0812-345-12',
      drugLicenseNo: 'DSL-DIST-2025-002',
      creditDays: 45,
      creditLimit: 2500000.0,
      currentBalance: 142000.0,
    },
    {
      code: 'SUP-003',
      name: 'Abbott Laboratories Logistics',
      contactPerson: 'Salman Qureshi',
      phone: '+92-21-35061122',
      email: 'logistics@abbott.pk',
      address: 'Landhi Industrial Area, Karachi',
      city: 'Karachi',
      ntn: '0987654-3',
      strn: '17-00-0987-654-15',
      drugLicenseNo: 'DSL-DIST-2025-003',
      creditDays: 30,
      creditLimit: 1000000.0,
      currentBalance: 49500.0,
    },
    {
      code: 'SUP-004',
      name: 'Searle Distribution Hub',
      contactPerson: 'Haris Javed',
      phone: '+92-42-35889900',
      email: 'orders.lhr@searle.pk',
      address: 'Quaid-e-Azam Industrial Estate, Kot Lakhpat, Lahore',
      city: 'Lahore',
      ntn: '0711223-9',
      strn: '17-00-0711-223-18',
      drugLicenseNo: 'DSL-DIST-2025-004',
      creditDays: 15,
      creditLimit: 500000.0,
      currentBalance: 0.0,
    },
  ];

  const suppliers: Record<string, string> = {};
  for (const s of suppliersList) {
    const sup = await prisma.supplier.upsert({
      where: { organizationId_code: { organizationId: org.id, code: s.code } },
      update: {
        name: s.name,
        contactPerson: s.contactPerson,
        phone: s.phone,
        email: s.email,
        address: s.address,
        city: s.city,
        ntn: s.ntn,
        strn: s.strn,
        drugLicenseNo: s.drugLicenseNo,
        creditDays: s.creditDays,
        creditLimit: s.creditLimit,
        currentBalance: s.currentBalance,
      },
      create: {
        organizationId: org.id,
        code: s.code,
        name: s.name,
        contactPerson: s.contactPerson,
        phone: s.phone,
        email: s.email,
        address: s.address,
        city: s.city,
        ntn: s.ntn,
        strn: s.strn,
        drugLicenseNo: s.drugLicenseNo,
        creditDays: s.creditDays,
        creditLimit: s.creditLimit,
        currentBalance: s.currentBalance,
        isActive: true,
      },
    });
    suppliers[s.code] = sup.id;
  }

  // =========================================================================
  // 9. CUSTOMERS
  // =========================================================================
  console.log('🏪 Seeding Customer Directory...');
  const customersList = [
    {
      code: 'CUST-WALKIN',
      name: 'Walk-in Cash Customer',
      customerType: CustomerType.WALK_IN,
      contactPerson: 'Counter Sales',
      phone: '+92-300-0000000',
      address: 'Over the counter cash dispensation',
      city: 'Karachi',
      creditDays: 0,
      creditLimit: 0.0,
      currentBalance: 0.0,
      defaultDiscountPercentage: 0.0,
    },
    {
      code: 'CUST-001',
      name: 'Shifa Pharmacy & Chemist',
      customerType: CustomerType.RETAIL_PHARMACY,
      contactPerson: 'Dr. Usman Ali',
      phone: '+92-301-8299100',
      email: 'shifa.pharmacy@gmail.com',
      address: 'Shop 4, Al-Madina Arcade, Gulshan-e-Iqbal Block 13-D',
      city: 'Karachi',
      ntn: '4300912-1',
      drugSaleLicenseNo: 'DSL-RET-2024-119',
      creditDays: 30,
      creditLimit: 250000.0,
      currentBalance: 32400.0,
      defaultDiscountPercentage: 2.5,
    },
    {
      code: 'CUST-002',
      name: 'City Medicos & Surgical',
      customerType: CustomerType.DISTRIBUTOR,
      contactPerson: 'Kamran Bashir',
      phone: '+92-321-4455667',
      email: 'citymedicos@yahoo.com',
      address: 'Katchery Road, Near Civil Hospital',
      city: 'Karachi',
      ntn: '5511223-4',
      drugSaleLicenseNo: 'DSL-WHS-2023-882',
      creditDays: 45,
      creditLimit: 600000.0,
      currentBalance: 87500.0,
      defaultDiscountPercentage: 5.0,
    },
    {
      code: 'CUST-003',
      name: 'Al-Razi Hospital Pharmacy',
      customerType: CustomerType.HOSPITAL,
      contactPerson: 'M. Kashif (Procurement Officer)',
      phone: '+92-333-9988771',
      email: 'procurement@alrazihospital.org',
      address: 'Main Stadium Road, Gulberg Town',
      city: 'Karachi',
      ntn: '7766554-9',
      drugSaleLicenseNo: 'DSL-HOSP-2025-009',
      creditDays: 60,
      creditLimit: 1200000.0,
      currentBalance: 164000.0,
      defaultDiscountPercentage: 7.0,
    },
    {
      code: 'CUST-004',
      name: 'Green Plus Medical Store',
      customerType: CustomerType.RETAIL_PHARMACY,
      contactPerson: 'Rizwan Ahmed',
      phone: '+92-345-2233445',
      email: 'greenplus@hotmail.com',
      address: 'Main Commercial Market, DHA Phase 2',
      city: 'Karachi',
      ntn: '6622334-8',
      drugSaleLicenseNo: 'DSL-RET-2024-301',
      creditDays: 15,
      creditLimit: 100000.0,
      currentBalance: 12000.0,
      defaultDiscountPercentage: 0.0,
    },
  ];

  const customers: Record<string, string> = {};
  for (const c of customersList) {
    const cust = await prisma.customer.upsert({
      where: { organizationId_code: { organizationId: org.id, code: c.code } },
      update: {
        name: c.name,
        customerType: c.customerType,
        contactPerson: c.contactPerson,
        phone: c.phone,
        email: c.email,
        address: c.address,
        city: c.city,
        ntn: c.ntn,
        drugSaleLicenseNo: c.drugSaleLicenseNo,
        creditDays: c.creditDays,
        creditLimit: c.creditLimit,
        currentBalance: c.currentBalance,
        defaultDiscountPercentage: c.defaultDiscountPercentage,
      },
      create: {
        organizationId: org.id,
        code: c.code,
        name: c.name,
        customerType: c.customerType,
        contactPerson: c.contactPerson,
        phone: c.phone,
        email: c.email,
        address: c.address,
        city: c.city,
        ntn: c.ntn,
        drugSaleLicenseNo: c.drugSaleLicenseNo,
        creditDays: c.creditDays,
        creditLimit: c.creditLimit,
        currentBalance: c.currentBalance,
        defaultDiscountPercentage: c.defaultDiscountPercentage,
        isActive: true,
      },
    });
    customers[c.code] = cust.id;
  }

  // =========================================================================
  // 10. PRODUCTS
  // =========================================================================
  console.log('💊 Seeding Product Master Catalog...');
  const productsList = [
    {
      sku: 'MED-PAN-500',
      name: 'Panadol 500mg',
      genericName: 'Paracetamol',
      manufacturer: 'GSK Pakistan',
      category: 'Analgesics & Antipyretics',
      unit: 'Box',
      dosageForm: 'Tablet',
      strength: '500mg',
      packSize: '20x10 Tablets',
      barcode: '8964000100012',
      taxPercentage: 0.0,
      description: 'First-line analgesic and antipyretic for mild-to-moderate pain and fever.',
    },
    {
      sku: 'MED-AUG-625',
      name: 'Augmentin 625mg',
      genericName: 'Amoxicillin + Clavulanic Acid',
      manufacturer: 'GSK Pakistan',
      category: 'Antibiotics',
      unit: 'Box',
      dosageForm: 'Tablet',
      strength: '625mg (500mg/125mg)',
      packSize: '2x7 Tablets',
      barcode: '8964000100029',
      taxPercentage: 0.0,
      description: 'Potent broad-spectrum antibacterial agent against beta-lactamase producing organisms.',
    },
    {
      sku: 'MED-BRU-400',
      name: 'Brufen 400mg',
      genericName: 'Ibuprofen',
      manufacturer: 'Abbott Laboratories',
      category: 'Analgesics & Antipyretics',
      unit: 'Box',
      dosageForm: 'Tablet',
      strength: '400mg',
      packSize: '30x10 Tablets',
      barcode: '8964000100036',
      taxPercentage: 0.0,
      description: 'Non-steroidal anti-inflammatory drug (NSAID) with anti-rheumatic and analgesic properties.',
    },
    {
      sku: 'MED-RSK-20',
      name: 'Risek 20mg',
      genericName: 'Omeprazole',
      manufacturer: 'Getz Pharma',
      category: 'Gastrointestinal',
      unit: 'Box',
      dosageForm: 'Capsule',
      strength: '20mg',
      packSize: '2x7 Capsules',
      barcode: '8964000100043',
      taxPercentage: 0.0,
      description: 'Proton pump inhibitor (PPI) for GERD, peptic ulcer disease, and acid reflux.',
    },
    {
      sku: 'MED-KLR-500',
      name: 'Klaricid 500mg',
      genericName: 'Clarithromycin',
      manufacturer: 'Abbott Laboratories',
      category: 'Antibiotics',
      unit: 'Box',
      dosageForm: 'Tablet',
      strength: '500mg',
      packSize: '2x7 Tablets',
      barcode: '8964000100050',
      taxPercentage: 0.0,
      description: 'Macrolide antibiotic for upper and lower respiratory tract infections.',
    },
    {
      sku: 'MED-ARN-FRT',
      name: 'Arinac Forte',
      genericName: 'Ibuprofen + Pseudoephedrine',
      manufacturer: 'Abbott Laboratories',
      category: 'Respiratory & Anti-Allergic',
      unit: 'Box',
      dosageForm: 'Tablet',
      strength: '400mg / 60mg',
      packSize: '10x10 Tablets',
      barcode: '8964000100067',
      taxPercentage: 0.0,
      description: 'Fast decongestant and analgesic for sinus congestion, cold, and flu symptoms.',
    },
    {
      sku: 'MED-CCN-500',
      name: 'Cecon 500mg',
      genericName: 'Vitamin C (Ascorbic Acid)',
      manufacturer: 'Abbott Laboratories',
      category: 'Nutritional & Vitamins',
      unit: 'Bottle',
      dosageForm: 'Chewable Tablet',
      strength: '500mg',
      packSize: '1x40 Tablets',
      barcode: '8964000100074',
      taxPercentage: 0.0,
      description: 'Immune defense supplement and essential ascorbic acid chewable formulation.',
    },
    {
      sku: 'MED-ETZ-DS',
      name: 'Entamizole DS',
      genericName: 'Metronidazole + Diloxanide Furoate',
      manufacturer: 'Abbott Laboratories',
      category: 'Gastrointestinal',
      unit: 'Box',
      dosageForm: 'Tablet',
      strength: '400mg / 500mg',
      packSize: '15x10 Tablets',
      barcode: '8964000100081',
      taxPercentage: 0.0,
      description: 'Combined lumenal and tissue amoebicide for amoebiasis and mixed GI protozoal infections.',
    },
    {
      sku: 'MED-SNC-SYR',
      name: 'Sancos Syrup 120ml',
      genericName: 'Dextromethorphan + Chlorpheniramine',
      manufacturer: 'Sanofi-Aventis Pakistan',
      category: 'Respiratory & Anti-Allergic',
      unit: 'Bottle',
      dosageForm: 'Syrup',
      strength: '15mg/5ml',
      packSize: '1x120ml Bottle',
      barcode: '8964000100098',
      taxPercentage: 0.0,
      description: 'Non-narcotic cough suppressant and antihistaminic formulation for dry irritating cough.',
    },
    {
      sku: 'MED-SLC-100',
      name: 'Solu-Cortef 100mg',
      genericName: 'Hydrocortisone Sodium Succinate',
      manufacturer: 'Getz Pharma',
      category: 'Cardiovascular',
      unit: 'Vial',
      dosageForm: 'Injection',
      strength: '100mg',
      packSize: '1x1 Vial + Diluent',
      barcode: '8964000100104',
      taxPercentage: 0.0,
      description: 'Emergency parenteral corticosteroid for acute adrenal insufficiency and severe anaphylaxis.',
    },
  ];

  const products: Record<string, string> = {};
  for (const p of productsList) {
    const prod = await prisma.product.upsert({
      where: { organizationId_sku: { organizationId: org.id, sku: p.sku } },
      update: {
        name: p.name,
        genericName: p.genericName,
        manufacturerId: manufacturers[p.manufacturer],
        categoryId: categories[p.category],
        unitId: units[p.unit],
        dosageForm: p.dosageForm,
        strength: p.strength,
        packSize: p.packSize,
        barcode: p.barcode,
        taxPercentage: p.taxPercentage,
        description: p.description,
      },
      create: {
        organizationId: org.id,
        sku: p.sku,
        name: p.name,
        genericName: p.genericName,
        manufacturerId: manufacturers[p.manufacturer],
        categoryId: categories[p.category],
        unitId: units[p.unit],
        dosageForm: p.dosageForm,
        strength: p.strength,
        packSize: p.packSize,
        barcode: p.barcode,
        taxPercentage: p.taxPercentage,
        description: p.description,
        isActive: true,
      },
    });
    products[p.sku] = prod.id;
  }

  // =========================================================================
  // 11. BATCHES & STOCK MOVEMENTS (OPENING INVENTORY)
  // =========================================================================
  console.log('📦 Seeding Batches and Warehouse Physical Inventory...');
  const now = new Date();
  const addMonths = (d: Date, m: number) => new Date(d.getTime() + m * 30 * 24 * 60 * 60 * 1000);
  const addDays = (d: Date, days: number) => new Date(d.getTime() + days * 24 * 60 * 60 * 1000);

  const batchesList = [
    // Panadol 500mg
    {
      productSku: 'MED-PAN-500',
      batchNumber: 'BN-90210',
      mfgDate: addMonths(now, -4),
      expiryDate: addMonths(now, 20),
      purchaseCost: 40.0,
      tradePrice: 45.0,
      retailPrice: 55.0,
      status: BatchStatus.ACTIVE,
      warehouseCode: 'WH-MAIN',
      openingQty: 300,
    },
    {
      productSku: 'MED-PAN-500',
      batchNumber: 'BN-90100', // Near expiry (45 days) for alerting demonstration!
      mfgDate: addMonths(now, -20),
      expiryDate: addDays(now, 45),
      purchaseCost: 38.0,
      tradePrice: 45.0,
      retailPrice: 55.0,
      status: BatchStatus.ACTIVE,
      warehouseCode: 'WH-MAIN',
      openingQty: 60,
    },
    // Augmentin 625mg
    {
      productSku: 'MED-AUG-625',
      batchNumber: 'AUG-7721',
      mfgDate: addMonths(now, -3),
      expiryDate: addMonths(now, 21),
      purchaseCost: 250.0,
      tradePrice: 280.0,
      retailPrice: 330.0,
      status: BatchStatus.ACTIVE,
      warehouseCode: 'WH-MAIN',
      openingQty: 150,
    },
    {
      productSku: 'MED-AUG-625',
      batchNumber: 'AUG-7600', // Quarantined batch in quarantine warehouse
      mfgDate: addMonths(now, -18),
      expiryDate: addDays(now, 20),
      purchaseCost: 245.0,
      tradePrice: 280.0,
      retailPrice: 330.0,
      status: BatchStatus.QUARANTINED,
      warehouseCode: 'WH-QUAR',
      openingQty: 25,
    },
    // Brufen 400mg
    {
      productSku: 'MED-BRU-400',
      batchNumber: 'BRU-4401',
      mfgDate: addMonths(now, -5),
      expiryDate: addMonths(now, 19),
      purchaseCost: 75.0,
      tradePrice: 85.0,
      retailPrice: 100.0,
      status: BatchStatus.ACTIVE,
      warehouseCode: 'WH-MAIN',
      openingQty: 200,
    },
    // Risek 20mg
    {
      productSku: 'MED-RSK-20',
      batchNumber: 'RSK-3319',
      mfgDate: addMonths(now, -2),
      expiryDate: addMonths(now, 22),
      purchaseCost: 175.0,
      tradePrice: 195.0,
      retailPrice: 230.0,
      status: BatchStatus.ACTIVE,
      warehouseCode: 'WH-MAIN',
      openingQty: 180,
    },
    // Klaricid 500mg
    {
      productSku: 'MED-KLR-500',
      batchNumber: 'KLR-8820',
      mfgDate: addMonths(now, -6),
      expiryDate: addMonths(now, 18),
      purchaseCost: 380.0,
      tradePrice: 420.0,
      retailPrice: 495.0,
      status: BatchStatus.ACTIVE,
      warehouseCode: 'WH-MAIN',
      openingQty: 90,
    },
    // Arinac Forte
    {
      productSku: 'MED-ARN-FRT',
      batchNumber: 'ARN-5510',
      mfgDate: addMonths(now, -3),
      expiryDate: addMonths(now, 21),
      purchaseCost: 110.0,
      tradePrice: 125.0,
      retailPrice: 145.0,
      status: BatchStatus.ACTIVE,
      warehouseCode: 'WH-MAIN',
      openingQty: 140,
    },
    // Cecon 500mg
    {
      productSku: 'MED-CCN-500',
      batchNumber: 'CEC-1102',
      mfgDate: addMonths(now, -1),
      expiryDate: addMonths(now, 23),
      purchaseCost: 98.0,
      tradePrice: 110.0,
      retailPrice: 130.0,
      status: BatchStatus.ACTIVE,
      warehouseCode: 'WH-MAIN',
      openingQty: 220,
    },
    // Entamizole DS
    {
      productSku: 'MED-ETZ-DS',
      batchNumber: 'ETZ-2291',
      mfgDate: addMonths(now, -4),
      expiryDate: addMonths(now, 20),
      purchaseCost: 80.0,
      tradePrice: 92.0,
      retailPrice: 108.0,
      status: BatchStatus.ACTIVE,
      warehouseCode: 'WH-MAIN',
      openingQty: 160,
    },
    // Sancos Syrup
    {
      productSku: 'MED-SNC-SYR',
      batchNumber: 'SNC-9944',
      mfgDate: addMonths(now, -3),
      expiryDate: addMonths(now, 15),
      purchaseCost: 65.0,
      tradePrice: 75.0,
      retailPrice: 88.0,
      status: BatchStatus.ACTIVE,
      warehouseCode: 'WH-MAIN',
      openingQty: 110,
    },
    // Solu-Cortef 100mg
    {
      productSku: 'MED-SLC-100',
      batchNumber: 'SLC-0082',
      mfgDate: addMonths(now, -2),
      expiryDate: addMonths(now, 22),
      purchaseCost: 190.0,
      tradePrice: 215.0,
      retailPrice: 250.0,
      status: BatchStatus.ACTIVE,
      warehouseCode: 'WH-COLD',
      openingQty: 75,
    },
  ];

  const batches: Record<string, string> = {};
  for (const b of batchesList) {
    const productId = products[b.productSku];
    const warehouseId = warehouses[b.warehouseCode];

    const batch = await prisma.batch.upsert({
      where: {
        productId_batchNumber: {
          productId,
          batchNumber: b.batchNumber,
        },
      },
      update: {
        mfgDate: b.mfgDate,
        expiryDate: b.expiryDate,
        purchaseCost: b.purchaseCost,
        tradePrice: b.tradePrice,
        retailPrice: b.retailPrice,
        status: b.status,
      },
      create: {
        productId,
        batchNumber: b.batchNumber,
        mfgDate: b.mfgDate,
        expiryDate: b.expiryDate,
        purchaseCost: b.purchaseCost,
        tradePrice: b.tradePrice,
        retailPrice: b.retailPrice,
        status: b.status,
      },
    });
    batches[`${b.productSku}:${b.batchNumber}`] = batch.id;

    // Check if initial stock movement already exists
    const existingMovement = await prisma.stockMovement.findFirst({
      where: {
        organizationId: org.id,
        branchId: hoBranch.id,
        warehouseId,
        productId,
        batchId: batch.id,
        movementType: StockMovementType.OPENING_BALANCE,
      },
    });

    if (!existingMovement) {
      await prisma.stockMovement.create({
        data: {
          organizationId: org.id,
          branchId: hoBranch.id,
          warehouseId,
          productId,
          batchId: batch.id,
          movementType: StockMovementType.OPENING_BALANCE,
          quantity: b.openingQty,
          unitCost: b.purchaseCost,
          referenceType: 'OPENING_BALANCE',
          referenceId: `SEED-${b.batchNumber}`,
          notes: `System demo bootstrap opening balance: ${b.openingQty} units in ${b.warehouseCode}`,
          createdByUserId: adminUser.id,
        },
      });
    }
  }

  // =========================================================================
  // 12. PROMOTIONAL SCHEMES & PRICING RULES
  // =========================================================================
  console.log('🏷️ Seeding Pricing Schemes & Promotional Bonus Rules...');
  // 1. Buy 10 Panadol, Get 1 Free (Bonus Units)
  await prisma.promotionalScheme.upsert({
    where: { organizationId_code: { organizationId: org.id, code: 'PANADOL-10-PLUS-1' } },
    update: {},
    create: {
      organizationId: org.id,
      name: 'Panadol Regular Trade Scheme (10+1 Free)',
      code: 'PANADOL-10-PLUS-1',
      description: 'Standard distributor incentive: Buy 10 packs of Panadol 500mg, get 1 free pack.',
      schemeType: SchemeType.BUY_X_GET_Y_FREE,
      productId: products['MED-PAN-500'],
      minQuantity: 10,
      bonusQuantity: 1,
      bonusProductId: products['MED-PAN-500'],
      startDate: addMonths(now, -1),
      endDate: addMonths(now, 11),
      isActive: true,
    },
  });

  // 2. Buy >= 20 Augmentin 625mg, Get 5% Bulk Trade Discount
  await prisma.promotionalScheme.upsert({
    where: { organizationId_code: { organizationId: org.id, code: 'AUGMENTIN-BULK-5PCT' } },
    update: {},
    create: {
      organizationId: org.id,
      name: 'Augmentin Bulk Pharmacy Discount (5% Off)',
      code: 'AUGMENTIN-BULK-5PCT',
      description: 'Volume discount for pharmacies ordering 20+ packs of Augmentin 625mg.',
      schemeType: SchemeType.BUY_X_GET_DISCOUNT,
      productId: products['MED-AUG-625'],
      minQuantity: 20,
      discountPercentage: 5.0,
      startDate: addMonths(now, -1),
      endDate: addMonths(now, 11),
      isActive: true,
    },
  });

  // 3. Customer-Specific Pricing Rule: Negotiated institutional rate on Augmentin for Al-Razi Hospital
  const alRaziCustomerId = customers['CUST-003'];
  const augmentinProductId = products['MED-AUG-625'];
  const existingCustPricing = await prisma.customerPricingRule.findFirst({
    where: {
      organizationId: org.id,
      customerId: alRaziCustomerId,
      productId: augmentinProductId,
    },
  });

  if (!existingCustPricing) {
    await prisma.customerPricingRule.create({
      data: {
        organizationId: org.id,
        customerId: alRaziCustomerId,
        productId: augmentinProductId,
        customPrice: 265.0, // Regular TP is 280.00
        minQuantity: 10,
        notes: 'Institutional negotiated rate under annual hospital supply contract.',
        isActive: true,
      },
    });
  }

  // =========================================================================
  // 13. MOCK PRODUCT RECALL (FOR STEP 9 DEMO)
  // =========================================================================
  console.log('🚨 Seeding Demo Product Recall Advisory...');
  const recallBatchId = batches['MED-AUG-625:AUG-7600'];
  const existingRecall = await prisma.productRecall.findFirst({
    where: {
      organizationId: org.id,
      recallNumber: 'RCL-2026-001',
    },
  });

  if (!existingRecall) {
    await prisma.productRecall.create({
      data: {
        organizationId: org.id,
        recallNumber: 'RCL-2026-001',
        productId: products['MED-AUG-625'],
        batchId: recallBatchId,
        reason: 'DRAP Quality Advisory Notice #QA-2026-44: Packaging seal integrity defect in batch AUG-7600.',
        severity: RecallSeverity.HIGH,
        status: RecallStatus.IN_PROGRESS,
        recallDate: addDays(now, -5),
        notes: 'Stock isolated into WH-QUAR quarantine hold. Distribution frozen across all branches.',
        createdById: adminUser.id,
      },
    });
  }

  // =========================================================================
  // 14. DEMO TRANSACTIONS (GRN, SALES INVOICE, AUDIT LOG)
  // =========================================================================
  console.log('📑 Seeding Historical Demo Transaction Vouchers & Ledgers...');

  // 14A. Historical Posted GRN (Goods Receive Note)
  const existingGrn = await prisma.goodsReceiveNote.findFirst({
    where: { organizationId: org.id, grnNumber: 'GRN-00001' },
  });

  if (!existingGrn) {
    const grn = await prisma.goodsReceiveNote.create({
      data: {
        organizationId: org.id,
        branchId: hoBranch.id,
        warehouseId: warehouses['WH-MAIN'],
        supplierId: suppliers['SUP-002'], // GSK
        grnNumber: 'GRN-00001',
        supplierInvoiceNumber: 'GSK-INV-9921',
        supplierInvoiceDate: addDays(now, -10),
        receivedDate: addDays(now, -10),
        status: GrnStatus.POSTED,
        subtotal: 10000.0,
        discountAmount: 0.0,
        taxAmount: 0.0,
        netTotal: 10000.0,
        paidAmount: 5000.0,
        balanceAmount: 5000.0,
        notes: 'Initial pharmaceutical stock delivery via cold container logistics.',
        postedAt: addDays(now, -10),
        postedByUserId: adminUser.id,
        items: {
          create: [
            {
              productId: products['MED-PAN-500'],
              batchId: batches['MED-PAN-500:BN-90210'],
              batchNumber: 'BN-90210',
              expiryDate: addMonths(now, 20),
              receivedQuantity: 250,
              bonusQuantity: 25,
              unitCost: 40.0,
              tradePrice: 45.0,
              retailPrice: 55.0,
              discountPercentage: 0.0,
              taxPercentage: 0.0,
              lineTotal: 10000.0,
            },
          ],
        },
      },
    });

    // Supplier Ledger Entry
    await prisma.supplierLedgerEntry.create({
      data: {
        organizationId: org.id,
        branchId: hoBranch.id,
        supplierId: suppliers['SUP-002'],
        grnId: grn.id,
        entryType: SupplierLedgerEntryType.GRN_INVOICE,
        referenceNumber: 'GRN-00001',
        debit: 0.0,
        credit: 10000.0,
        runningBalance: 142000.0,
        transactionDate: addDays(now, -10),
        notes: 'Goods Receive Note #GRN-00001 (Supplier Inv #GSK-INV-9921)',
        createdByUserId: adminUser.id,
      },
    });
  }

  // 14B. Historical Posted Sales Invoice
  const existingInv = await prisma.salesInvoice.findFirst({
    where: { organizationId: org.id, invoiceNumber: 'INV-00001' },
  });

  if (!existingInv) {
    const inv = await prisma.salesInvoice.create({
      data: {
        organizationId: org.id,
        branchId: hoBranch.id,
        warehouseId: warehouses['WH-MAIN'],
        customerId: customers['CUST-001'], // Shifa Pharmacy
        invoiceNumber: 'INV-00001',
        invoiceDate: addDays(now, -2),
        status: SalesInvoiceStatus.POSTED,
        paymentMethod: PaymentMethod.CREDIT_ACCOUNT,
        subtotal: 900.0,
        discountAmount: 0.0,
        taxAmount: 0.0,
        netTotal: 900.0,
        paidAmount: 0.0,
        balanceAmount: 900.0,
        totalCostPrice: 800.0,
        grossProfit: 100.0,
        notes: 'Dispatched to Shifa Pharmacy against Purchase Order #PO-SHIFA-881',
        postedAt: addDays(now, -2),
        postedByUserId: cashierUser.id,
        items: {
          create: [
            {
              productId: products['MED-PAN-500'],
              batchId: batches['MED-PAN-500:BN-90210'],
              batchNumber: 'BN-90210',
              expiryDate: addMonths(now, 20),
              billedQuantity: 20,
              bonusQuantity: 2,
              totalQuantity: 22,
              unitCost: 40.0,
              tradePrice: 45.0,
              retailPrice: 55.0,
              unitPrice: 45.0,
              discountPercentage: 0.0,
              discountAmount: 0.0,
              taxPercentage: 0.0,
              taxAmount: 0.0,
              lineTotal: 900.0,
              lineCost: 880.0,
              lineProfit: 20.0,
              pricingSource: 'PROMOTIONAL_SCHEME',
              schemeName: 'Panadol Regular Trade Scheme (10+1 Free)',
            },
          ],
        },
      },
    });

    // Customer Ledger Entry for Invoice
    await prisma.customerLedgerEntry.create({
      data: {
        organizationId: org.id,
        branchId: hoBranch.id,
        customerId: customers['CUST-001'],
        salesInvoiceId: inv.id,
        entryType: CustomerLedgerEntryType.SALES_INVOICE,
        referenceNumber: 'INV-00001',
        debit: 900.0,
        credit: 0.0,
        runningBalance: 32400.0,
        transactionDate: addDays(now, -2),
        notes: 'Sales Invoice #INV-00001 (Panadol 500mg x 20 + 2 Bonus)',
        createdByUserId: cashierUser.id,
      },
    });

    // Customer Payment Receipt Voucher
    const existingPmt = await prisma.customerPayment.findFirst({
      where: { organizationId: org.id, paymentNumber: 'REC-00001' },
    });

    if (!existingPmt) {
      const pmt = await prisma.customerPayment.create({
        data: {
          organizationId: org.id,
          branchId: hoBranch.id,
          customerId: customers['CUST-001'],
          paymentNumber: 'REC-00001',
          paymentDate: addDays(now, -1),
          paymentMethod: PaymentMethod.BANK_TRANSFER,
          amount: 5000.0,
          allocatedAmount: 900.0,
          unallocatedAmount: 4100.0,
          referenceNumber: 'TXN-HBL-992384',
          bankName: 'Habib Bank Limited (HBL)',
          notes: 'Online interbank transfer via Raast for account settlement',
          status: CustomerPaymentStatus.POSTED,
          postedAt: addDays(now, -1),
          postedByUserId: cashierUser.id,
          allocations: {
            create: [
              {
                salesInvoiceId: inv.id,
                amountAllocated: 900.0,
              },
            ],
          },
        },
      });

      // Customer Ledger Entry for Payment
      await prisma.customerLedgerEntry.create({
        data: {
          organizationId: org.id,
          branchId: hoBranch.id,
          customerId: customers['CUST-001'],
          customerPaymentId: pmt.id,
          entryType: CustomerLedgerEntryType.PAYMENT,
          referenceNumber: 'REC-00001',
          debit: 0.0,
          credit: 5000.0,
          runningBalance: 27400.0,
          transactionDate: addDays(now, -1),
          notes: 'Customer Payment Receipt #REC-00001 (HBL Raast Ref #TXN-HBL-992384)',
          createdByUserId: cashierUser.id,
        },
      });
    }
  }

  // 14C. Stock Transfer from WH-MAIN to WH-DISP
  const existingTrf = await prisma.stockTransfer.findFirst({
    where: { organizationId: org.id, transferNumber: 'TRF-00001' },
  });

  if (!existingTrf) {
    await prisma.stockTransfer.create({
      data: {
        organizationId: org.id,
        branchId: hoBranch.id,
        transferNumber: 'TRF-00001',
        sourceWarehouseId: warehouses['WH-MAIN'],
        destinationWarehouseId: warehouses['WH-DISP'],
        transferDate: addDays(now, -1),
        status: StockTransferStatus.RECEIVED,
        notes: 'Routine shelf replenishment for active counter dispensing.',
        createdById: pharmacistUser.id,
        dispatchedById: pharmacistUser.id,
        dispatchedAt: addDays(now, -1),
        receivedById: cashierUser.id,
        receivedAt: addDays(now, -1),
        items: {
          create: [
            {
              productId: products['MED-PAN-500'],
              batchId: batches['MED-PAN-500:BN-90210'],
              batchNumber: 'BN-90210',
              expiryDate: addMonths(now, 20),
              requestedQuantity: 30,
              dispatchedQuantity: 30,
              receivedQuantity: 30,
              unitCost: 40.0,
              notes: 'Transferred 30 packs of Panadol 500mg to fast dispensary shelf.',
            },
          ],
        },
      },
    });
  }

  // 14D. Audit Trail Log Entries
  const existingAudit = await prisma.auditLog.findFirst({
    where: { action: 'SEED_INITIALIZATION' },
  });

  if (!existingAudit) {
    await prisma.auditLog.create({
      data: {
        userId: adminUser.id,
        action: 'SEED_INITIALIZATION',
        entity: 'SYSTEM',
        entityId: org.id,
        details: {
          event: 'Initial demo dataset seeded successfully',
          version: '1.0.0',
          seededProductsCount: productsList.length,
          seededBatchesCount: batchesList.length,
          seededSuppliersCount: suppliersList.length,
          seededCustomersCount: customersList.length,
        },
        ipAddress: '127.0.0.1',
        userAgent: 'Medix-Seeder-CLI/1.0',
      },
    });
  }

  console.log('✅ Medix by FARMAX database seeding completed successfully!');
  console.log('---------------------------------------------------------');
  console.log('Demo Accounts:');
  console.log('  1. Administrator:  admin      / AdminPassword123!');
  console.log('  2. Pharmacist:     pharmacist / Medix@2026');
  console.log('  3. Cashier:        cashier    / Medix@2026');
  console.log('---------------------------------------------------------');
}

main()
  .catch((e) => {
    console.error('❌ Database seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
