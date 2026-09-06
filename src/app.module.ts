import {
  Module,
  NestModule,
  MiddlewareConsumer,
  RequestMethod,
} from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { IncomingMessage } from 'http';
import { configuration, validateEnvironment } from './config';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { AuditModule } from './modules/audit/audit.module';
import { OrganizationModule } from './modules/organization/organization.module';
import { NumberingModule } from './modules/numbering/numbering.module';
import { SettingsModule } from './modules/settings/settings.module';
import { MasterDataModule } from './modules/master-data/master-data.module';
import { ProductModule } from './modules/product/product.module';
import { BatchModule } from './modules/batch/batch.module';
import { WarehouseModule } from './modules/warehouse/warehouse.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { SupplierModule } from './modules/supplier/supplier.module';
import { PurchasingModule } from './modules/purchasing/purchasing.module';
import { CustomerModule } from './modules/customer/customer.module';
import { SalesModule } from './modules/sales/sales.module';
import { CustomerPaymentModule } from './modules/customer-payment/customer-payment.module';
import { SalesReturnModule } from './modules/sales-return/sales-return.module';
import { SupplierPaymentModule } from './modules/supplier-payment/supplier-payment.module';
import { PurchaseReturnModule } from './modules/purchase-return/purchase-return.module';
import { PricingModule } from './modules/pricing/pricing.module';
import { StockTransferModule } from './modules/stock-transfer/stock-transfer.module';
import { ExpiryModule } from './modules/expiry/expiry.module';
import { ReportsModule } from './modules/reports/reports.module';
import { AdminModule } from './modules/admin/admin.module';
import { ImportsModule } from './modules/imports/imports.module';
import { OnboardingModule } from './modules/onboarding/onboarding.module';
import { CorrelationIdMiddleware } from './common/middleware/correlation-id.middleware';
import { CORRELATION_ID_HEADER } from './common/constants';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validate: validateEnvironment,
    }),
    LoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const isProd = config.get<string>('nodeEnv') === 'production';
        const logLevel = config.get<string>('logLevel') || 'info';

        return {
          pinoHttp: {
            level: logLevel,
            customProps: (req: IncomingMessage) => {
              const correlationId =
                (req as IncomingMessage & { correlationId?: string })
                  .correlationId ||
                (req.headers[CORRELATION_ID_HEADER] as string) ||
                '';
              return { correlationId };
            },
            transport: isProd
              ? undefined
              : {
                  target: 'pino-pretty',
                  options: {
                    colorize: true,
                    singleLine: true,
                    translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
                  },
                },
          },
        };
      },
    }),
    PrismaModule,
    HealthModule,
    AuthModule,
    AuditModule,
    OrganizationModule,
    NumberingModule,
    SettingsModule,
    MasterDataModule,
    ProductModule,
    BatchModule,
    WarehouseModule,
    InventoryModule,
    SupplierModule,
    PurchasingModule,
    CustomerModule,
    SalesModule,
    CustomerPaymentModule,
    SalesReturnModule,
    SupplierPaymentModule,
    PurchaseReturnModule,
    PricingModule,
    StockTransferModule,
    ExpiryModule,
    ReportsModule,
    AdminModule,
    ImportsModule,
    OnboardingModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(CorrelationIdMiddleware)
      .forRoutes({ path: '{*path}', method: RequestMethod.ALL });
  }
}
