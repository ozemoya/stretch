import type { ScrapeReport } from "./retailer-scraper";

/** Keep dated in-store observations while a broader online catalog search runs. */
export function mergeCatalogReports(
  base: ScrapeReport,
  incoming: ScrapeReport,
): ScrapeReport {
  const lines = base.lines.map((line) => {
    const update = incoming.lines.find(
      (other) => other.item.id === line.item.id,
    );
    const bySource = new Map(
      line.products.map((product) => [product.sourceUrl, product]),
    );
    for (const product of update?.products ?? [])
      bySource.set(product.sourceUrl, product);
    const products = [...bySource.values()];
    return {
      item: line.item,
      products,
      ...(update?.error ? { error: update.error } : {}),
    };
  });
  return {
    retailer: base.retailer,
    status: lines.some((line) => line.products.length)
      ? "retrieved"
      : incoming.status === "pending"
        ? "pending"
        : base.status,
    detail: base.detail.includes(incoming.detail)
      ? base.detail
      : [base.detail, incoming.detail].filter(Boolean).join(" "),
    lines,
  };
}
