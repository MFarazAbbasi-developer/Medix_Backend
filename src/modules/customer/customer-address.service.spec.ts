import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CustomerService } from './customer.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';

describe('CustomerAddressService', () => {
  let service: CustomerService;
  let prisma: any;
  let auditService: any;

  const mockCustomer = {
    id: 'cust-1',
    organizationId: 'org-1',
    code: 'CUST-001',
    name: 'Al-Shifa Pharmacy',
    customerType: 'RETAIL_PHARMACY',
    isActive: true,
  };

  const mockWalkInCustomer = {
    id: 'cust-walkin',
    organizationId: 'org-1',
    code: 'CUST-WALKIN',
    name: 'Walk-In Customer',
    customerType: 'WALK_IN',
    isActive: true,
  };

  const mockAddress1 = {
    id: 'addr-1',
    organizationId: 'org-1',
    customerId: 'cust-1',
    title: 'Main Branch Pharmacy',
    recipientName: 'Dr. Tariq',
    phone: '03001234567',
    address: 'Shop 12, Main Market',
    city: 'Karachi',
    routeId: 'route-1',
    deliveryInstructions: 'Deliver 10am-4pm',
    isDefault: true,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockAddress2 = {
    id: 'addr-2',
    organizationId: 'org-1',
    customerId: 'cust-1',
    title: 'Warehouse Depot',
    recipientName: 'Imran',
    phone: '03219876543',
    address: 'Plot 44, Korangi',
    city: 'Karachi',
    routeId: 'route-2',
    deliveryInstructions: null,
    isDefault: false,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    prisma = {
      organization: {
        findFirst: vi.fn().mockResolvedValue({ id: 'org-1', name: 'Test Org' }),
      },
      branch: {
        findFirst: vi.fn().mockResolvedValue({ id: 'branch-1', isHeadOffice: true }),
      },
      customer: {
        findFirst: vi.fn().mockImplementation(({ where }) => {
          if (where.id === 'cust-1') return Promise.resolve(mockCustomer);
          if (where.id === 'cust-walkin') return Promise.resolve(mockWalkInCustomer);
          return Promise.resolve(null);
        }),
      },
      salesRoute: {
        findFirst: vi.fn().mockImplementation(({ where }) => {
          if (where.id === 'route-1' || where.id === 'route-2') {
            return Promise.resolve({ id: where.id, name: 'Test Route', branchId: null });
          }
          return Promise.resolve(null);
        }),
      },
      customerDeliveryAddress: {
        findFirst: vi.fn().mockImplementation(({ where }) => {
          if (where.id === 'addr-1' && (where.customerId === undefined || where.customerId === 'cust-1')) {
            return Promise.resolve(mockAddress1);
          }
          if (where.id === 'addr-2' && (where.customerId === undefined || where.customerId === 'cust-1')) {
            return Promise.resolve(mockAddress2);
          }
          return Promise.resolve(null);
        }),
        findMany: vi.fn().mockResolvedValue([mockAddress1, mockAddress2]),
        create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'addr-new', ...data })),
        update: vi.fn().mockImplementation(({ where, data }) => Promise.resolve({ id: where.id, ...data })),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        delete: vi.fn().mockResolvedValue({ id: 'addr-deleted' }),
      },
      salesInvoice: {
        count: vi.fn().mockResolvedValue(0),
      },
      $transaction: vi.fn().mockImplementation(async (callback) => callback(prisma)),
    };

    auditService = {
      log: vi.fn().mockResolvedValue(undefined),
    };

    service = new CustomerService(prisma as PrismaService, auditService as AuditService);
  });

  describe('createCustomerAddress', () => {
    it('creates a delivery address successfully for customer', async () => {
      const res = await service.createCustomerAddress(
        'cust-1',
        {
          title: 'Emergency Unit',
          recipientName: 'Staff On Duty',
          phone: '03009988776',
          address: 'Stadium Road',
          city: 'Karachi',
          routeId: 'route-1',
          isDefault: false,
        },
        'user-1',
      );

      expect(prisma.customerDeliveryAddress.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            customerId: 'cust-1',
            title: 'Emergency Unit',
            address: 'Stadium Road',
            isDefault: false,
          }),
        }),
      );
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CREATE_CUSTOMER_DELIVERY_ADDRESS' }),
      );
      expect(res).toBeDefined();
    });

    it('atomically unsets previous defaults when creating a new default address', async () => {
      await service.createCustomerAddress(
        'cust-1',
        {
          title: 'New Main Unit',
          address: 'Stadium Road',
          isDefault: true,
        },
        'user-1',
      );

      expect(prisma.customerDeliveryAddress.updateMany).toHaveBeenCalledWith({
        where: { customerId: 'cust-1', organizationId: 'org-1', isDefault: true },
        data: { isDefault: false },
      });
      expect(prisma.customerDeliveryAddress.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            isDefault: true,
          }),
        }),
      );
    });

    it('rejects creating address for WALK_IN customer', async () => {
      await expect(
        service.createCustomerAddress('cust-walkin', {
          title: 'Any Title',
          address: 'Any Address',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects setting an inactive address as default', async () => {
      await expect(
        service.createCustomerAddress('cust-1', {
          title: 'Inactive Branch',
          address: 'Some Address',
          isDefault: true,
          isActive: false,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects invalid route that does not exist in organization', async () => {
      await expect(
        service.createCustomerAddress('cust-1', {
          title: 'Branch 3',
          address: 'Some Address',
          routeId: 'invalid-route',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('setDefaultCustomerAddress', () => {
    it('atomically sets an address as default and unsets others', async () => {
      const res = await service.setDefaultCustomerAddress('cust-1', 'addr-2', 'user-1');

      expect(prisma.customerDeliveryAddress.updateMany).toHaveBeenCalledWith({
        where: { customerId: 'cust-1', organizationId: 'org-1', isDefault: true },
        data: { isDefault: false },
      });
      expect(prisma.customerDeliveryAddress.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'addr-2' },
          data: { isDefault: true },
        }),
      );
      expect(res).toBeDefined();
    });

    it('rejects setting an inactive address as default', async () => {
      prisma.customerDeliveryAddress.findFirst.mockResolvedValueOnce({
        ...mockAddress2,
        isActive: false,
      });

      await expect(
        service.setDefaultCustomerAddress('cust-1', 'addr-2', 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('deleteCustomerAddress', () => {
    it('physically deletes unreferenced delivery address', async () => {
      prisma.salesInvoice.count.mockResolvedValueOnce(0);

      const res = await service.deleteCustomerAddress('cust-1', 'addr-2', 'user-1');

      expect(prisma.customerDeliveryAddress.delete).toHaveBeenCalledWith({
        where: { id: 'addr-2' },
      });
      expect(res.softDeleted).toBe(false);
    });

    it('soft-deactivates referenced delivery address', async () => {
      prisma.salesInvoice.count.mockResolvedValueOnce(3);

      const res = await service.deleteCustomerAddress('cust-1', 'addr-1', 'user-1');

      expect(prisma.customerDeliveryAddress.update).toHaveBeenCalledWith({
        where: { id: 'addr-1' },
        data: { isActive: false, isDefault: false },
      });
      expect(prisma.customerDeliveryAddress.delete).not.toHaveBeenCalled();
      expect(res.softDeleted).toBe(true);
    });
  });

  describe('getCustomerAddresses & isolation', () => {
    it('returns all customer delivery addresses ordered by default first', async () => {
      const res = await service.getCustomerAddresses('cust-1');

      expect(res).toHaveLength(2);
      expect(prisma.customerDeliveryAddress.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ customerId: 'cust-1' }),
        }),
      );
    });

    it('throws 404 when accessing address belonging to another customer', async () => {
      await expect(
        service.getCustomerAddressById('cust-other', 'addr-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
