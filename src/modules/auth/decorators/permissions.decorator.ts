import { SetMetadata, CustomDecorator } from '@nestjs/common';
import { PERMISSIONS_KEY } from '../constants';

/**
 * Decorator to declare required permissions on a route handler or controller.
 * Example: @RequirePermissions('sales.create', 'sales.view')
 */
export const RequirePermissions = (
  ...permissions: string[]
): CustomDecorator<string> => SetMetadata(PERMISSIONS_KEY, permissions);
