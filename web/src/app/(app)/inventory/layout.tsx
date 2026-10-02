import { SectionNav } from '@/components/section-nav';

export default function InventoryLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <SectionNav
        label="Inventory sections"
        items={[
          { href: '/inventory', label: 'Stock' },
          { href: '/inventory/receive', label: 'Receive stock' },
          { href: '/inventory/products/new', label: 'Add product' },
          { href: '/inventory/recall', label: 'Recall lookup' },
        ]}
      />
      {children}
    </div>
  );
}
