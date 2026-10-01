import Link from 'next/link';

export default function InventoryLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <nav aria-label="Inventory sections" className="flex flex-wrap gap-4 border-b border-gray-200 pb-2 text-sm">
        <Link href="/inventory" className="hover:underline">Stock</Link>
        <Link href="/inventory/receive" className="hover:underline">Receive stock</Link>
        <Link href="/inventory/products/new" className="hover:underline">Add product</Link>
        <Link href="/inventory/recall" className="hover:underline">Recall lookup</Link>
      </nav>
      {children}
    </div>
  );
}
