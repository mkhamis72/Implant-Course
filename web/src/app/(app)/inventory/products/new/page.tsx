import { requirePermission } from '@/lib/auth/session';
import { ProductForm } from '../product-form';
import { createProduct } from '../actions';

export default async function NewProductPage() {
  await requirePermission('inventory', 'edit');
  return (
    <div className="space-y-6">
      <h1>Add product</h1>
      <ProductForm action={createProduct} />
    </div>
  );
}
