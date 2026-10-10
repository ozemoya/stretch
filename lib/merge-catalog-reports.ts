import type { ScrapeReport } from "./retailer-scraper";

/** Keep dated in-store observations while a broader online catalog search runs. */
export function mergeCatalogReports(
  base: ScrapeReport,
  incoming: ScrapeReport,
): ScrapeReport {
  if (base.retailer !== incoming.retailer)
    throw new Error("Cannot merge catalogs from different retailers.");
  const sourceLines = [...base.lines];
  for (const line of incoming.lines)
    if (!sourceLines.some((existing) => existing.item.id === line.item.id))
      sourceLines.push(line);
  const lines = sourceLines.map((line) => {
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
      ...(update?.searchStatus || line.searchStatus
        ? { searchStatus: update?.searchStatus ?? line.searchStatus }
        : {}),
    };
  });
  return {
    retailer: base.retailer,
    status: lines.some((line) => line.products.length)
      ? "retrieved"
      : incoming.status,
    detail: base.detail.includes(incoming.detail)
      ? base.detail
      : [base.detail, incoming.detail].filter(Boolean).join(" "),
    lines,
  };
}
