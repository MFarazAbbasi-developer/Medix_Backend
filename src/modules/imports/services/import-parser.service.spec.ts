import { describe, it, expect, beforeEach } from 'vitest';
import { ImportParserService } from './import-parser.service';
import { ImportType } from '@prisma/client';
import * as XLSX from 'xlsx';

describe('ImportParserService', () => {
  let parserService: ImportParserService;

  beforeEach(() => {
    parserService = new ImportParserService();
  });

  it('should generate CSV templates for all import types', () => {
    const types = [
      ImportType.PRODUCTS,
      ImportType.CUSTOMERS,
      ImportType.SUPPLIERS,
      ImportType.OPENING_STOCK,
      ImportType.CUSTOMER_OPENING_BALANCES,
      ImportType.SUPPLIER_OPENING_BALANCES,
    ];

    for (const t of types) {
      const template = parserService.generateCsvTemplate(t);
      expect(template.buffer).toBeInstanceOf(Buffer);
      expect(template.buffer.length).toBeGreaterThan(0);
      expect(template.filename).toContain('.csv');
    }
  });

  it('should parse CSV buffer into normalized row objects', () => {
    const csvContent = `SKU,Product Name,Generic Name,Manufacturer,Trade Price\nMED-001,Panadol 500mg,Paracetamol,GSK,45.00\nMED-002,Augmentin 625mg,Amoxicillin,GSK,220.00`;
    const buffer = Buffer.from(csvContent, 'utf-8');

    const result = parserService.parseBuffer(buffer, 'products.csv');
    expect(result.totalRows).toBe(2);
    expect(result.rows[0].sku).toBe('MED-001');
    expect(result.rows[0].name).toBe('Panadol 500mg');
    expect(result.rows[0].genericName).toBe('Paracetamol');
    expect(result.rows[0].manufacturer).toBe('GSK');
    expect(result.rows[0].tradePrice).toBe('45.00');
  });

  it('should parse XLSX buffer correctly', () => {
    const data = [
      { Code: 'CUST-001', Name: 'Al-Shifa', CustomerType: 'RETAIL_PHARMACY' },
      { Code: 'CUST-002', Name: 'Civil Hosp', CustomerType: 'HOSPITAL' },
    ];
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    const xlsxBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const result = parserService.parseBuffer(xlsxBuffer, 'customers.xlsx');
    expect(result.totalRows).toBe(2);
    expect(result.rows[0].code).toBe('CUST-001');
    expect(result.rows[0].name).toBe('Al-Shifa');
    expect(result.rows[0].customerType).toBe('RETAIL_PHARMACY');
  });

  it('should reject empty files', () => {
    expect(() => parserService.parseBuffer(Buffer.alloc(0), 'empty.csv')).toThrowError(
      /uploaded file is empty/i,
    );
  });
});
