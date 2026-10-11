import type { AgentItem, StoreCheck } from "../price-agent";
import type { StoreCoverage } from "../retailer-coverage";
import type { NearbyPlace } from "../live-data";
import type { SearchPlan } from "../local-search-agent";
import type { SearchStatus } from "../search-state";

export type ScrapedProduct = {
  id: string;
  name: string;
  brand: string;
  size: string;
  priceCents: number;
  sourceUrl: string;
  imageUrl?: string;
  upc?: string;
  matchKind?: "alternative";
  verification?: "official-page-observation";
  retrievedAt: string;
  retailerId?: string;
  storeLocationId?: string | null;
  productId?: string;
  productName?: string;
  price?: number;
  priceSource?: string;
  verifiedAt?: string;
  productUrl?: string;
};
export type ScrapeReport = {
  retailer: string;
  status: "retrieved" | "pending" | "failed" | "unsupported" | "blocked";
  detail: string;
  lines: {
    item: AgentItem;
    products: ScrapedProduct[];
    error?: string;
    searchStatus?: SearchStatus;
  }[];
};

export type ScrapeContext = {
  retailer: string; stores: StoreCoverage[]; items: AgentItem[];
  places: NearbyPlace[]; zip: string; plan?: SearchPlan; signal?: AbortSignal; fast?: boolean;
  onReport?: (report: ScrapeReport) => void;
};
export interface RetailerScraper {
  id: string;
  scrape(context: ScrapeContext): Promise<ScrapeReport>;
  checkBranches?(context: ScrapeContext): Promise<StoreCheck[]>;
}
