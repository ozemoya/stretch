import type { createClient } from "@supabase/supabase-js";

export type KrogerUnit = "each" | "oz" | "fl-oz";
export type KrogerAmount = { unit: KrogerUnit; amount: number };
export type KrogerOrigin = { latitude: number; longitude: number };

export interface KrogerDietaryFilters {
  /** True requires an explicit product-name claim; false/omitted applies no filter. */
  glutenFree?: boolean;
  vegan?: boolean;
  nutFree?: boolean;
}

export interface KrogerDietaryFlags {
  /** Null means the provider description did not establish this attribute. */
  gluten_free: boolean | null;
  vegan: boolean | null;
  nut_free: boolean | null;
}

export interface KrogerSearchOptions extends KrogerDietaryFilters {
  item: string;
  /** A number uses `unit` or the item's inferred unit; strings accept "1 gal", "12 ct", etc. */
  amount?: number | string | KrogerAmount;
  unit?: KrogerUnit;
  /** Exact Kroger category label, such as Dairy. Omit to infer it from matching products. */
  category?: string;
  /** Pass the visitor's coordinates in hosted applications. */
  origin?: KrogerOrigin;
  /** Alternative to origin. With neither, IP lookup locates the machine executing the library. */
  zip?: string;
  /** Explicit repair override; normal requests always reuse today's prices. */
  forceRefresh?: boolean;
}

export interface KrogerDependencies {
  env?: Record<string, string | undefined>;
  fetcher?: typeof fetch;
  /** Optional callback for step-by-step progress. Library calls are quiet by default. */
  log?: (message: string) => void;
  makeClient?: typeof createClient;
  /** Injectable clock for testing calendar-day freshness. Defaults to the current instant. */
  now?: () => Date;
}

export interface KrogerWinner extends KrogerDietaryFlags {
  search_term: string;
  requested_amount?: KrogerAmount;
  requested_dietary?: KrogerDietaryFilters;
  search_zip?: string;
  location_id: string;
  store_name: string;
  store_address: {
    addressLine1?: string;
    addressLine2?: string;
    city?: string;
    state?: string;
    zipCode?: string;
  };
  store_geolocation: KrogerOrigin;
  distance_miles: number;
  store_rank: number;
  product_id: string;
  item_id: string;
  description: string;
  brand: string | null;
  upc: string | null;
  package_size: string | null;
  sold_by: "UNIT";
  regular_price_cents: number;
  promo_price_cents: number | null;
  comparison_unit: KrogerUnit;
  /** Normalized amount used to compare prices, e.g. 128 fl-oz for one gallon. */
  package_quantity: number;
  /** Individual physical items, e.g. 12 eggs, one jug, or one can. */
  package_count: number;
  unit_price_cents: number;
  price_basis: "unit";
  matched_category: string;
  provider_categories: string[];
  retrieved_at: string;
}

export type KrogerIssue =
  | { kind: "fewer-stores"; message: string }
  | {
      kind: "no-match" | "store-search-failed" | "search-limited";
      locationId: string;
      message: string;
    };

export interface KrogerSearchResult {
  /** Newly searched winners only; cached records lack provider description/package metadata. */
  rows: KrogerWinner[];
  /** All available results in nearest-store order, including saved database hits. */
  products: KrogerProductResult[];
  /** False for missing matches, failed stores or Kroger's 300-product search cap. */
  complete: boolean;
  issues: KrogerIssue[];
}

export interface KrogerProductResult extends KrogerProductRow {
  source: "database" | "kroger";
  store: KrogerStoreRow;
}

export interface KrogerProductRow extends KrogerDietaryFlags {
  ID: number;
  category: string;
  count: number;
  /** Dollars per package. */
  price: number;
  /** Dollars per comparison_unit, independent of the physical item count. */
  unit_price: number;
  locationID: number;
  location_key: string;
  /** Last price retrieval day (YYYY-MM-DD) in America/New_York; historical rows may be null. */
  date: string | null;
}

export interface KrogerStoreRow {
  locationID: number;
  location_key: string;
  retailer_key: "kroger";
  location_scope: "branch";
  source_location_id: string;
  store: "Kroger";
  "sub-location": string | null;
  latitude: number | null;
  longitude: number | null;
  address: string | null;
}
