import type { ScrapeReport, ScrapedProduct } from "./retailer-scraper";
import { catalogLineStatus } from "./search-state";
import type { AgentItem } from "./price-agent";
import { isCloseFood } from "./food-alternatives";

const sourceHosts: Record<string, string[]> = {
  "Kroger family": ["www.kroger.com"],
  "Whole Foods": ["www.wholefoodsmarket.com"],
  Lidl: ["www.lidl.com"],
  "Trader Joe’s": ["www.traderjoes.com"],
  "The Fresh Market": [
    "shop.thefreshmarket.com",
    "www.thefreshmarket.com",
    "www.instacart.com",
  ],
  ALDI: ["www.instacart.com"],
  Publix: ["www.instacart.com"],
  "Food Lion": ["www.instacart.com"],
  "Sam’s Club": ["www.instacart.com"],
  Walmart: ["www.walmart.com"],
  Target: ["www.target.com"],
  Sprouts: ["shop.sprouts.com"],
  Costco: ["www.costco.com"],
  "Albertsons family": ["www.safeway.com"],
};
const instacartSlugs: Record<string, string> = {
  ALDI: "aldi",
  Publix: "publix",
  "The Fresh Market": "the-fresh-market",
  "Food Lion": "food-lion",
  "Sam’s Club": "sams-club",
};
export function knownRetailerForUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.hostname === "www.instacart.com") {
      const slug = url.pathname.match(/^\/store\/([^/]+)\/products\//)?.[1];
      return (
        Object.entries(instacartSlugs).find(
          ([, known]) => known === slug,
        )?.[0] ?? null
      );
    }
    return (
      Object.entries(sourceHosts).find(
        ([, hosts]) =>
          hosts.includes(url.hostname) && url.hostname !== "www.instacart.com",
      )?.[0] ?? null
    );
  } catch {
    return null;
  }
}

export function catalogSourceBelongsToRetailer(
  retailerId: string,
  value: string,
) {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      !sourceHosts[retailerId]?.includes(url.hostname)
    )
      return false;
    if (url.hostname === "www.instacart.com")
      return url.pathname.startsWith(
        `/store/${instacartSlugs[retailerId]}/products/`,
      );
    return true;
  } catch {
    return false;
  }
}

export type OwnedCatalogProduct = ScrapedProduct & {
  retailerId: string;
  storeLocationId: null;
  productId: string;
  productName: string;
  price: number;
  priceSource: string;
  verifiedAt: string;
  productUrl: string;
};

export function ownedCatalogProducts(
  report: ScrapeReport,
  products: ScrapedProduct[],
): OwnedCatalogProduct[] {
  const seen = new Set<string>();
  return products.flatMap((product) => {
    if (
      !catalogSourceBelongsToRetailer(report.retailer, product.sourceUrl) ||
      (product.retailerId && product.retailerId !== report.retailer) ||
      product.storeLocationId != null ||
      !Number.isInteger(product.priceCents) ||
      product.priceCents <= 0 ||
      !Number.isFinite(Date.parse(product.retrievedAt))
    )
      return [];
    const id = String(product.productId ?? product.id);
    const key = `${report.retailer}:${id}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [
      {
        ...product,
        retailerId: report.retailer,
        storeLocationId: null,
        productId: id,
        productName: product.name,
        price: product.priceCents / 100,
        priceSource: report.detail,
        verifiedAt: product.retrievedAt,
        productUrl: product.sourceUrl,
      },
    ];
  });
}

export function normalizeCatalogReport(
  report: ScrapeReport,
  items?: AgentItem[],
): ScrapeReport {
  const sourceLines =
    items?.map(
      (item) =>
        report.lines.find((line) => line.item.id === item.id) ?? {
          item,
          products: [],
        },
    ) ?? report.lines;
  const filtered = sourceLines.map((line) => {
    const relevant = /\bchicken\b/i.test(line.item.name)
      ? line.products.filter((product) => isCloseFood(line.item.name, product.name))
      : line.products;
    const products = ownedCatalogProducts(report, relevant);
    return {
      ...line,
      products,
      searchStatus: products.length
        ? ("completed" as const)
        : line.searchStatus === "completed"
          ? ("price_unavailable" as const)
          : line.searchStatus,
    };
  });
  const intermediate = { ...report, lines: filtered };
  const lines = filtered.map((line) => ({
    ...line,
    searchStatus:
      line.searchStatus ?? catalogLineStatus(intermediate, line.item.id),
  }));
  return {
    ...report,
    lines,
    status: lines.some((line) => line.products.length)
      ? "retrieved"
      : report.status === "retrieved"
        ? "failed"
        : report.status,
  };
}
