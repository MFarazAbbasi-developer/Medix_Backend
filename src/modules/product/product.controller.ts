import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ProductService } from './product.service';
import {
  CreateProductDto,
  UpdateProductDto,
} from './dto/create-update-product.dto';
import { QueryProductDto } from './dto/query-product.dto';
import {
  JwtAuthGuard,
  PermissionsGuard,
  RequirePermissions,
  CurrentUser,
  CurrentUserPayload,
} from '../auth';

@Controller('products')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ProductController {
  constructor(private readonly productService: ProductService) {}

  @Get()
  @RequirePermissions('products.view')
  async findAll(@Query() query: QueryProductDto) {
    return this.productService.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('products.view')
  async findOne(@Param('id') id: string) {
    return this.productService.findOne(id);
  }

  @Post()
  @RequirePermissions('products.create')
  async create(
    @Body() dto: CreateProductDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.productService.create(dto, user?.userId);
  }

  @Patch(':id')
  @RequirePermissions('products.edit')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.productService.update(id, dto, user?.userId);
  }

  @Patch(':id/status')
  @RequirePermissions('products.disable')
  async toggleStatus(
    @Param('id') id: string,
    @Body('isActive') isActive: boolean,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.productService.toggleStatus(id, Boolean(isActive), user?.userId);
  }
}
