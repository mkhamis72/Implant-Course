import { ProductForm } from '../product-form';
import { createProduct } from '../actions';

export default function NewProductPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Add product</h1>
      <ProductForm action={createProduct} />
    </div>
  );
}
