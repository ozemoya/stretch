"use client";

import { useState } from "react";
import { foodAlternatives } from "@/lib/food-alternatives";
import { packageMatches } from "@/lib/package-match";
import type { AgentItem } from "@/lib/price-agent";
import type { ScrapeReport, ScrapedProduct } from "@/lib/retailer-scraper";

function ProductPhoto({ product }: { product: ScrapedProduct }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="comparison-photo">
      {product.imageUrl && !failed ? (
        <img
          src={product.imageUrl}
          alt={product.name}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        <span>Photo not supplied</span>
      )}
    </div>
  );
}

function missingPriceReason(report: ScrapeReport, error?: string) {
  if (report.status === "pending") return "This store search is still running.";
  if (report.status === "blocked" || report.status === "unsupported")
    return "No connected price source for this store.";
  if (/not searched|limit reached|collection limited/i.test(error ?? ""))
    return "This item was not searched in this run.";
  if (/verified product url|source_needed/i.test(error ?? ""))
    return "No usable product page was found for this item.";
  if (/blocked|crawling rules|denied/i.test(error ?? ""))
    return "The store website blocked this price check.";
  if (report.status === "failed" || error)
    return "The search did not return a priced matching package.";
  return "No priced matching package was found at this store.";
}

export default function StoreColumns({
  reports,
  items,
}: {
  reports: ScrapeReport[];
  items: AgentItem[];
}) {
  return (
    <div
      className="store-comparison"
      role="region"
      aria-label="Compare foods across grocery stores"
      tabIndex={0}
    >
      {reports.map((report) => (
        <article className="store-column" key={report.retailer}>
          <div className="store-column-heading">
            <span className="eyebrow">GROCERY STORE</span>
            <h3>{report.retailer}</h3>
            <p>
              {report.lines.filter((line) => line.products.length).length} of{" "}
              {items.length} {items.length === 1 ? "item" : "items"} priced
            </p>
            <span className="comparison-status">
              {report.status === "pending"
                ? "Searching website…"
                : report.status === "retrieved"
                  ? "Online listing found"
                  : "No usable store price"}
            </span>
          </div>
          {items.map((item) => {
            const line = report.lines.find(
              (entry) => entry.item.id === item.id,
            );
            const products = line?.products ?? [];
            const product = products[0];
            const alternatives = product
              ? []
              : foodAlternatives(reports, report.retailer, item.id, item.name);
            return (
              <div className="comparison-food" key={item.id}>
                <div className="comparison-request">
                  <strong>{item.name}</strong>
                  <span>× {item.quantity}</span>
                </div>
                {product ? (
                  <>
                    {product.verification === "official-page-observation" && (
                      <span className="comparison-substitute">
                        Retailer website · dated observation
                      </span>
                    )}
                    {product.matchKind === "alternative" && (
                      <span className="comparison-substitute">
                        Similar item · review before choosing
                      </span>
                    )}
                    {!packageMatches(item.unit, product.size) && (
                      <span className="comparison-substitute">
                        Different package size · compare before choosing
                      </span>
                    )}
                    <ProductPhoto key={product.id} product={product} />
                    <a
                      href={product.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="comparison-product-name"
                    >
                      {product.name} ↗
                    </a>
                    <p className="comparison-size">{product.size}</p>
                    <strong className="comparison-price">
                      ${(product.priceCents / 100).toFixed(2)}
                      <small> / package</small>
                    </strong>
                    <p className="small">
                      Recorded {new Date(product.retrievedAt).toLocaleString()}
                    </p>
                    {products.length > 1 && (
                      <details>
                        <summary>{products.length - 1} other packages</summary>
                        {products.slice(1).map((other) => (
                          <div
                            className="comparison-alternative"
                            key={other.id}
                          >
                            <ProductPhoto product={other} />
                            <a
                              href={other.sourceUrl}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {other.name}
                            </a>
                            <p>
                              {other.size} · $
                              {(other.priceCents / 100).toFixed(2)}
                            </p>
                          </div>
                        ))}
                      </details>
                    )}
                  </>
                ) : (
                  <div className="comparison-missing">
                    <strong>{missingPriceReason(report, line?.error)}</strong>
                    {report.status !== "pending" && (
                      <p>
                        {report.status === "blocked" ||
                        report.status === "unsupported"
                          ? report.detail
                          : "A nearby store on the map does not confirm this branch's shelf price."}
                      </p>
                    )}
                    {report.retailer === "The Fresh Market" && (
                      <a
                        href={`https://shop.thefreshmarket.com/store/the-fresh-market/s?k=${encodeURIComponent(item.name)}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Check this food in The Fresh Market catalog ↗
                      </a>
                    )}
                  </div>
                )}
                {!product && alternatives.length > 0 && (
                  <div className="comparison-fallback">
                    <p className="comparison-substitute">
                      Similar options at other stores
                    </p>
                    <p className="small">
                      These are not {report.retailer} prices.
                    </p>
                    {alternatives.map((other) => (
                      <div key={other.sourceRetailer + other.id}>
                        <ProductPhoto product={other} />
                        <strong>{other.sourceRetailer}</strong>
                        <a
                          href={other.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {other.name} ↗
                        </a>
                        <p>
                          {other.size} · ${(other.priceCents / 100).toFixed(2)}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          <footer>
            <details>
              <summary>Price source details</summary>
              <p>{report.detail}</p>
              {report.lines
                .filter((line) => line.error && !line.products.length)
                .map((line) => (
                  <p key={line.item.id}>
                    <strong>{line.item.name}:</strong> {line.error}
                  </p>
                ))}
            </details>
          </footer>
        </article>
      ))}
    </div>
  );
}
