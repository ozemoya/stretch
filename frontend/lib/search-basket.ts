import type { BasketItem, Product } from "./types";

export function addSearchItems(
  query: string,
  products: Product[],
  basket: BasketItem[],
) {
  const terms = query.split(/[,;\n&]+|\band\b/i).map((term) => term.trim()).filter(Boolean);
  const matched: Product[] = [];
  const unmatched: string[] = [];
  for (const term of terms) {
    const normalized = term.toLowerCase().replace(/\s+/g, " ");
    const product = products.find((entry) => entry.name.toLowerCase() === normalized)
      ?? products.find((entry) => entry.name.toLowerCase().includes(normalized));
    if (!product) unmatched.push(term);
    else if (!matched.some((entry) => entry.id === product.id)) matched.push(product);
  }
  const existing = new Set(basket.map((item) => item.productId));
  return {
    basket: [...basket, ...matched.filter((product) => !existing.has(product.id))
      .map((product) => ({ productId: product.id, quantity: 1 }))],
    matched,
    unmatched,
  };
}
