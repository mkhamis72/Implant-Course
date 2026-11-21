/** Shown where a product dropdown is empty because the company has switched nothing on yet (0128). */
export const NO_PRODUCTS = 'No products switched on yet. An admin chooses them in Admin → Catalogue.';

export function NoProductsHint() {
  return <p className="text-sm text-muted">{NO_PRODUCTS}</p>;
}
