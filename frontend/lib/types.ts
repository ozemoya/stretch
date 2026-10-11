export type Product = {
  id: string;
  name: string;
  emoji: string;
  category: string;
  unit: string;
  vegan: boolean;
  glutenFree: boolean;
  nutFree: boolean;
};
export type Store = {
  id: string;
  name: string;
  address?: string;
  latitude?: number | null;
  longitude?: number | null;
};
export type Offer = {
  productId: string;
  storeId: string;
  priceCents: number;
  recordedAt: string;
  isSample: boolean;
  available: boolean;
  productName?: string | null;
  packageSize?: string | null;
  sourceUrl?: string | null;
  priceSource?: string | null;
  unitBasis?: string | null;
  requestedUnit?: string | null;
};
export type Swap = { fromId: string; toId: string; note: string };
export type Catalog = {
  products: Product[];
  stores: Store[];
  offers: Offer[];
  swaps: Swap[];
};
export type BasketItem = { productId: string; quantity: number };
export type Preferences = {
  area: "downtown" | "midtown" | "decatur";
  budget: number;
  mpg: number;
  gas: number;
  maxStops: number;
  minExtraStopSavings: number;
  shoppingPriority: "balanced" | "lowest_cost" | "fewest_stops";
  vegan: boolean;
  glutenFree: boolean;
  nutFree: boolean;
};
export type Purchase = {
  productId: string;
  name: string;
  unit: string;
  quantity: number;
  priceCents: number;
  recordedAt: string;
  isSample: boolean;
};
export type Trip = {
  id: string;
  stops: { store: Store; items: Purchase[] }[];
  missing: string[];
  foodCents: number;
  fuelCents: number;
  totalCents: number;
  miles: number;
  minutes: number;
};
