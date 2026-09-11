import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
} from '@nestjs/common';
import { CustomerService } from './customer.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { QueryCustomerDto, QueryCustomerLedgerDto } from './dto/query-customer.dto';
import { UpsertCustomerPricingRuleDto } from './dto/customer-pricing.dto';
import {
  CreateCustomerAddressDto,
  UpdateCustomerAddressDto,
  QueryCustomerAddressDto,
} from './dto/customer-address.dto';
import {
  JwtAuthGuard,
  PermissionsGuard,
  RequirePermissions,
  CurrentUser,
  CurrentUserPayload,
} from '../auth';

@Controller('customers')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CustomerController {
  constructor(private readonly customerService: CustomerService) {}

  @Get()
  @RequirePermissions('customers.view')
  async getCustomers(@Query() query: QueryCustomerDto) {
    return this.customerService.getCustomers(query);
  }

  @Get(':id')
  @RequirePermissions('customers.view')
  async getCustomerById(@Param('id') id: string) {
    return this.customerService.getCustomerById(id);
  }

  @Post()
  @RequirePermissions('customers.create')
  async createCustomer(
    @Body() dto: CreateCustomerDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.customerService.createCustomer(dto, user?.userId);
  }

  @Put(':id')
  @RequirePermissions('customers.edit')
  async updateCustomer(
    @Param('id') id: string,
    @Body() dto: UpdateCustomerDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.customerService.updateCustomer(id, dto, user?.userId);
  }

  @Get(':id/ledger')
  @RequirePermissions('customers.ledger_view')
  async getCustomerLedger(
    @Param('id') id: string,
    @Query() query: QueryCustomerLedgerDto,
  ) {
    return this.customerService.getCustomerLedger(id, query);
  }

  @Get(':id/pricing')
  @RequirePermissions('customers.view')
  async getCustomerPricing(@Param('id') id: string) {
    return this.customerService.getCustomerPricing(id);
  }

  @Put(':id/pricing')
  @RequirePermissions('customers.edit')
  async upsertCustomerPricing(
    @Param('id') id: string,
    @Body() dto: UpsertCustomerPricingRuleDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.customerService.upsertCustomerPricing(id, dto, user?.userId);
  }

  // =========================================================================
  // DELIVERY ADDRESSES
  // =========================================================================

  @Get(':customerId/addresses')
  @RequirePermissions('customers.view')
  async getCustomerAddresses(
    @Param('customerId') customerId: string,
    @Query() query: QueryCustomerAddressDto,
  ) {
    return this.customerService.getCustomerAddresses(customerId, query);
  }

  @Get(':customerId/addresses/:addressId')
  @RequirePermissions('customers.view')
  async getCustomerAddressById(
    @Param('customerId') customerId: string,
    @Param('addressId') addressId: string,
  ) {
    return this.customerService.getCustomerAddressById(customerId, addressId);
  }

  @Post(':customerId/addresses')
  @RequirePermissions('customers.edit')
  async createCustomerAddress(
    @Param('customerId') customerId: string,
    @Body() dto: CreateCustomerAddressDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.customerService.createCustomerAddress(customerId, dto, user?.userId);
  }

  @Put(':customerId/addresses/:addressId')
  @RequirePermissions('customers.edit')
  async updateCustomerAddress(
    @Param('customerId') customerId: string,
    @Param('addressId') addressId: string,
    @Body() dto: UpdateCustomerAddressDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.customerService.updateCustomerAddress(
      customerId,
      addressId,
      dto,
      user?.userId,
    );
  }

  @Patch(':customerId/addresses/:addressId/default')
  @RequirePermissions('customers.edit')
  async setDefaultCustomerAddress(
    @Param('customerId') customerId: string,
    @Param('addressId') addressId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.customerService.setDefaultCustomerAddress(
      customerId,
      addressId,
      user?.userId,
    );
  }

  @Delete(':customerId/addresses/:addressId')
  @RequirePermissions('customers.edit')
  async deleteCustomerAddress(
    @Param('customerId') customerId: string,
    @Param('addressId') addressId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.customerService.deleteCustomerAddress(
      customerId,
      addressId,
      user?.userId,
    );
  }
}
