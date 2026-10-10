// Consolidate this run's checkpoints and independently verify its saved rows.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createClient } from "@supabase/supabase-js";
import { productRow } from "../lib/kroger/core.mjs";

const filenames = [
  "kroger-catalog-2026-10-10.json",
  "kroger-catalog-2026-10-10-resumed.json",
  "kroger-catalog-2026-10-10-retry.json",
];
const reports = await Promise.all(filenames.map(async (file) =>
  JSON.parse(await readFile(new URL(file, import.meta.url), "utf8"))));
const entries = new Map();
const matches = new Map();
for (const report of reports) {
  for (const entry of report.results) {
    entries.set(entry.catalog_id, structuredClone(entry));
    for (const row of entry.rows ?? []) {
      matches.set(productRow(row).ID, {
        row,
        issues: (entry.issues ?? []).filter((issue) =>
          issue.kind === "search-limited" && issue.locationId === row.location_id),
      });
    }
  }
}
const final = { ...reports[1], checkpoints: filenames, results: [...entries.values()] };
for (const entry of final.results) {
  const knownIssues = new Map((entry.issues ?? []).map((issue) =>
    [`${issue.kind}:${issue.locationId ?? ""}`, issue]));
  entry.matched_products = (entry.products ?? []).map((product) => {
    const match = matches.get(product.ID);
    assert.ok(match, `Missing winner details for ${product.ID}`);
    for (const issue of match.issues)
      knownIssues.set(`${issue.kind}:${issue.locationId}`, issue);
    return { ...product, matched: match.row };
  });
  entry.issues = [...knownIssues.values()];
  entry.complete = !entry.error && entry.products?.length === 3 && !entry.issues.length;
}
const products = final.results.flatMap((entry) => entry.products ?? []);
assert.equal(final.results.length, 30);
assert.equal(new Set(products.map((product) => product.ID)).size, products.length);
final.completed = final.results.filter((entry) => entry.complete).length;
final.partial = final.results.filter((entry) => !entry.complete && !entry.error).length;
final.failed = final.results.filter((entry) => entry.error).length;
final.summary = {
  attempted_catalog_ids: final.results.length,
  catalog_ids_with_prices: final.results.filter((entry) => entry.products?.length).length,
  saved_store_prices: products.length,
  catalog_ids_with_all_three_stores: final.results.filter((entry) => entry.products?.length === 3).length,
  partial_store_coverage: final.results.filter((entry) => entry.products?.length > 0 && entry.products.length < 3).map((entry) => entry.catalog_id),
  no_eligible_match: final.results.filter((entry) => !entry.error && !entry.products?.length).map((entry) => entry.catalog_id),
  capped_searches: final.results.filter((entry) => entry.issues.some((issue) => issue.kind === "search-limited")).map((entry) => entry.catalog_id),
};

if (process.argv.includes("--verify")) {
  const require = createRequire(import.meta.url);
  createRequire(require.resolve("next/package.json"))("@next/env").loadEnvConfig(process.cwd(), true);
  const db = createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(20000) }) } },
  );
  const [saved, stores, catalog] = await Promise.all([
    db.from("product").select("ID,category,count,price,unit_price,locationID,date").in("ID", products.map((product) => product.ID)),
    db.from("store").select("locationID,store,sub-location,latitude,longitude,address").in("locationID", [...new Set(products.map((product) => product.locationID))]),
    db.from("products").select("id").order("id"),
  ]);
  for (const result of [saved, stores, catalog])
    assert.ok(!result.error, `Supabase verification failed: ${result.error?.message}`);
  assert.equal(saved.data.length, products.length);
  assert.equal(stores.data.length, 3);
  assert.deepEqual(catalog.data.map((row) => row.id), [...entries.keys()].sort());
  const byId = new Map(saved.data.map((row) => [row.ID, row]));
  const storeById = new Map(stores.data.map((row) => [row.locationID, row]));
  for (const product of products) {
    const saved = byId.get(product.ID);
    for (const field of ["ID", "category", "count", "locationID", "date"])
      assert.equal(saved[field], product[field], `${product.ID}.${field}`);
    for (const field of ["price", "unit_price"])
      assert.ok(Math.abs(saved[field] - product[field]) < 1e-10, `${product.ID}.${field}`);
    assert.equal(saved.date, final.date);
    const matched = matches.get(product.ID).row;
    assert.equal(saved.count, matched.package_count);
    assert.ok(Math.abs(saved.unit_price - matched.regular_price_cents / 100 / matched.package_quantity) < 1e-10);
    assert.deepEqual(storeById.get(product.locationID), product.store);
  }
  final.verification = { checked_at: new Date().toISOString(), matched_database_rows: saved.data.length, linked_stores: stores.data.length, catalog_ids: catalog.data.length, checks: ["saved IDs", "package counts", "prices", "normalized unit prices", "date", "store links and metadata"] };
}
final.finished_at = reports[2].finished_at;
await writeFile(new URL("kroger-catalog-2026-10-10-final.json", import.meta.url), JSON.stringify(final, null, 2) + "\n");
console.log(JSON.stringify({ ...final.summary, verification: final.verification }, null, 2));
