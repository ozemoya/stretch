import type { ScrapeReport, ScrapedProduct } from "./retailer-scraper";
import { catalogLineStatus } from "./search-state";
import type { AgentItem } from "./price-agent";
import { isCloseFood } from "./food-alternatives";

import { catalogSourceBelongsToRetailer } from "./retailer-sources";
export { catalogSourceBelongsToRetailer, knownRetailerForUrl } from "./retailer-sources";

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
