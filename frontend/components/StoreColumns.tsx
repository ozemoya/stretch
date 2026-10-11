"use client";

import { useEffect, useState } from "react";
import ProductImage from "./ProductImage";
import { normalizedUnitPrice, packageMatches } from "@/lib/package-match";
import { ownedCatalogProducts, type OwnedCatalogProduct } from "@/lib/product-ownership";
import { addCatalogPick, catalogPick, readCatalogPicks, writeCatalogPicks } from "@/lib/catalog-picks";
import { SMART_CART_EVENT } from "@/lib/smart-cart";
import { catalogLineStatus, searchStatusLabel } from "@/lib/search-state";
import type { AgentItem } from "@/lib/price-agent";
import type { ScrapeReport, ScrapedProduct } from "@/lib/retailer-scraper";

function ProductPhoto({ product }: { product: ScrapedProduct }) {
  return <ProductImage className="comparison-photo" name={product.name} brand={product.brand}
    size={product.size} upc={product.upc} retailerImageUrl={product.imageUrl}
    retailerSourceUrl={product.sourceUrl} />;
}

export default function StoreColumns({
  reports,
  items,
  onRetry,
}: {
  reports: ScrapeReport[];
  items: AgentItem[];
  onRetry?: (retailerId: string) => void;
}) {
  const [savedIds, setSavedIds] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  useEffect(() => {
    const sync = () => setSavedIds(readCatalogPicks(localStorage).map((pick) => pick.id));
    sync(); window.addEventListener("storage", sync); window.addEventListener(SMART_CART_EVENT, sync);
    return () => { window.removeEventListener("storage", sync); window.removeEventListener(SMART_CART_EVENT, sync); };
  }, []);
  function save(item: AgentItem, product: OwnedCatalogProduct) {
    const pick = catalogPick(item, product);
    if (!pick) { setMessage("This product could not be saved. Try another listing."); return; }
    const next = addCatalogPick(readCatalogPicks(localStorage), pick);
    if (!writeCatalogPicks(localStorage, next)) { setMessage("Could not save this product on this device."); return; }
    setSavedIds(next.map((entry) => entry.id));
    setMessage(`${product.productName} saved as an online listing. Open Smart Cart to review it.`);
    window.dispatchEvent(new Event(SMART_CART_EVENT));
  }
  return (
    <div
      className="store-comparison"
      role="region"
      aria-label="Compare online retailer catalog listings"
      tabIndex={0}
    >
      {message && <p role="status" className="catalog-pick-message">{message} <a href="/cart">Open Smart Cart ↗</a></p>}
      {reports.map((report) => (
        <article className="store-column" key={report.retailer}>
          <div className="store-column-heading">
            <span className="eyebrow">
              ONLINE PRICES · CHECK LOCAL STORE
            </span>
            <h3>{report.retailer}</h3>
            <p>
              {
                items.filter(
                  (item) =>
                    ownedCatalogProducts(
                      report,
                      report.lines.find((line) => line.item.id === item.id)
                        ?.products ?? [],
                    ).length,
                ).length
              }{" "}
              of {items.length} {items.length === 1 ? "item" : "items"} priced
            </p>
            {report.status !== "retrieved" && (
              <span className="comparison-status">
                {report.status === "pending" ? "Searching website…" : "Live pricing unavailable"}
              </span>
            )}
            {onRetry &&
              report.lines.some((line) =>
                ["timeout", "error"].includes(
                  catalogLineStatus(report, line.item.id),
                ),
              ) && (
                <button type="button" onClick={() => onRetry(report.retailer)}>
                  Retry search
                </button>
              )}
          </div>
          {items.map((item) => {
            const line = report.lines.find(
              (entry) => entry.item.id === item.id,
            );
            const products = ownedCatalogProducts(report, line?.products ?? []);
            const product = products[0];
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
                    {normalizedUnitPrice(product.priceCents, product.size) && (
                      <p className="comparison-size">
                        $
                        {(
                          normalizedUnitPrice(product.priceCents, product.size)!
                            .displayCents / 100
                        ).toFixed(2)}{" "}
                        /{" "}
                        {
                          normalizedUnitPrice(product.priceCents, product.size)!
                            .displayUnit
                        }
                      </p>
                    )}
                    <p className="small">
                      {product.priceSource} · updated{" "}
                      {new Date(product.verifiedAt).toLocaleString()}
                    </p>
                    <button type="button" className="catalog-pick-button" onClick={() => save(item, product)}>
                      {savedIds.includes(`${item.id}:${product.retailerId}:${product.productId}`) ? "Add another" : "Save to Smart Cart"}
                    </button>
                    <small className="comparison-size">Online listing</small>
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
                            <button type="button" className="catalog-pick-button" onClick={() => save(item, other)}>Save to Smart Cart</button>
                          </div>
                        ))}
                      </details>
                    )}
                  </>
                ) : (
                  <div className="comparison-missing">
                    <strong>
                      {searchStatusLabel(catalogLineStatus(report, item.id))}
                    </strong>
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
