import type { AgentItem } from "./price-agent";
import type { ScrapeReport } from "./retailer-scraper";
import { normalizeCatalogReport } from "./product-ownership";

const normalized = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
const itemKey = (item: AgentItem) => JSON.stringify([normalized(item.name), normalized(item.unit)]);

/** Reuses source evidence, never refreshes its verifiedAt/retrievedAt timestamps. */
export class CatalogCache {
  private entries = new Map<string, { zip: string; key: string; expires: number; report: ScrapeReport }>();

  put(zip: string, raw: ScrapeReport, now = Date.now()) {
    const report = normalizeCatalogReport(raw);
    for (const line of report.lines) {
      const products = line.products.filter((product) => {
        const age = now - Date.parse(product.retrievedAt);
        return age >= 0 && age < 86_400_000;
      });
      if (!products.length) continue;
      const key = itemKey(line.item);
      const id = JSON.stringify([zip, report.retailer, key]);
      if (this.entries.size >= 500) this.entries.delete(this.entries.keys().next().value!);
      this.entries.set(id, { zip, key, expires: now + 300_000,
        report: { ...report, lines: [{ ...line, products }] } });
    }
  }

  read(zip: string, items: AgentItem[], now = Date.now()): ScrapeReport[] {
    const reports = new Map<string, ScrapeReport>();
    for (const [id, entry] of this.entries) {
      if (entry.expires <= now) { this.entries.delete(id); continue; }
      if (entry.zip !== zip) continue;
      for (const item of items.filter((item) => itemKey(item) === entry.key)) {
        const report = reports.get(entry.report.retailer) ?? { ...entry.report, lines: [] };
        report.lines.push({ ...entry.report.lines[0], item });
        reports.set(report.retailer, report);
      }
    }
    return [...reports.values()].map((report) => normalizeCatalogReport(report, items));
  }
}

export const catalogCache = new CatalogCache();
