import { SectionNav } from '@/components/section-nav';
import { requirePermission } from '@/lib/auth/session';
import { canEdit } from '@/lib/auth/permissions';

export default async function InventoryLayout({ children }: { children: React.ReactNode }) {
  const profile = await requirePermission('inventory');
  const editable = canEdit(profile, 'inventory');
  return (
    <div className="space-y-6">
      <SectionNav
        label="Inventory sections"
        items={[
          { href: '/inventory', label: 'Stock' },
          ...(editable
            ? [
                { href: '/inventory/receive', label: 'Receive stock' },
                { href: '/inventory/products/new', label: 'Add product' },
              ]
            : []),
          { href: '/inventory/recall', label: 'Recall lookup' },
        ]}
      />
      {children}
    </div>
  );
}
