import { featureOn, type Feature } from '@/lib/modules/modules';

/**
 * The shortages card follows the plan, not the user's Inventory permission: Schedule viewers see
 * it even with no Inventory access (0033), but a company without Inventory has no stock to be short of.
 */
export function showShortageCard(canViewSchedule: boolean, features: readonly Feature[]): boolean {
  return canViewSchedule && featureOn(features, 'inventory');
}
