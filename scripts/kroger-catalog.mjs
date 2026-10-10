import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";
import {
  normalizeSearchOptions,
  parsePackageSize,
  productDate,
  resolveOrigin,
  run,
} from "../lib/kroger/core.mjs";

export function catalogSearchOptions(product, location = {}) {
  if (typeof product.id !== "string" || !product.id.trim())
    throw new Error("Catalog product is missing its ID.");
  const amount = parsePackageSize(product.unit);
  const rules = {
    cheddar: { category: "Dairy" },
    milk: { category: "Dairy" },
    eggs: { category: "Dairy" },
    yogurt: { category: "Dairy" },
    "oat-milk": { category: "Dairy" },
    "soy-yogurt": { category: "Dairy" },
    "plant-cheese": { category: "Dairy" },
    "black-beans": { category: "Canned & Packaged" },
    chickpeas: { item: "garbanzo beans", category: "Canned & Packaged" },
    chicken: { category: "Meat & Seafood" },
    bread: { category: "Bakery", unit: "oz" },
    "frozen-peas": { category: "Frozen" },
    // The catalog uses oz shorthand for this liquid's 16.9-fluid-ounce bottle.
    "olive-oil":
      amount?.unit === "oz"
        ? { unit: "fl-oz", amount: { unit: "fl-oz", amount: amount.amount } }
        : {},
  };
  return normalizeSearchOptions({
    ...location,
    item: product.name,
    ...(amount ? { amount, unit: amount.unit } : {}),
    // Other catalog labels describe app groupings rather than Kroger categories.
    ...(product.category === "Produce" ? { category: "Produce" } : {}),
    ...(rules[product.id] ?? {}),
  });
}

export async function runCatalog(
  options = {},
  {
    env = process.env,
    fetcher = fetch,
    makeClient = createClient,
    runSearch = run,
    log = console.log,
    now = () => new Date(),
    checkpoint = async () => {},
  } = {},
) {
  const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    env.SUPABASE_SECRET_KEY ||
    env.SUPABASE_SERVICE_ROLE_KEY ||
    (options.dryRun &&
      (env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
        env.NEXT_PUBLIC_SUPABASE_ANON_KEY));
  if (!url || !key)
    throw new Error("Missing Supabase credentials for catalog lookup.");
  // Validate location inputs before making requests.
  const location = normalizeSearchOptions({ ...options, item: "catalog" });
  const db = makeClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) =>
        fetcher(input, { ...init, signal: AbortSignal.timeout(20000) }),
    },
  });
  log(
    "[Catalog] Reading every products.id with its name, category and package unit.",
  );
  const catalog = new Map();
  for (let start = 0; ; start += 500) {
    const { data, error } = await db
      .from("products")
      .select("id,name,category,unit")
      .order("id")
      .range(start, start + 499);
    if (error || !Array.isArray(data))
      throw new Error(
        "Could not read the products catalog; no searches started.",
      );
    for (const row of data) {
      if (catalog.has(row.id))
        throw new Error(
          "Catalog pagination repeated a product ID; no searches started.",
        );
      catalog.set(row.id, row);
    }
    if (data.length < 500) break;
  }
  log(
    `[Catalog] ${catalog.size} product IDs loaded. Resolving the search location once.`,
  );
  for (const id of [
    ...(options.productIds ?? []),
    ...(options.refreshIds ?? []),
  ])
    if (!catalog.has(id))
      throw new Error(`Unknown catalog ID: ${id}. No searches started.`);
  const selected = [...catalog.values()].filter(
    (product) => !options.productIds || options.productIds.includes(product.id),
  );
  const origin = await resolveOrigin(location, fetcher, log);
  const report = {
    date: productDate(now()),
    origin,
    dryRun: options.dryRun ?? false,
    total: selected.length,
    results: [],
  };
  for (const [index, product] of selected.entries()) {
    log(
      `\n[Catalog ${index + 1}/${selected.length}] products.id=${product.id} | ${product.name} | ${product.unit}`,
    );
    try {
      const search = catalogSearchOptions(product, {
        origin,
        glutenFree: options.glutenFree,
        vegan: options.vegan,
        nutFree: options.nutFree,
        dryRun: options.dryRun ?? false,
        forceRefresh: options.refreshIds?.includes(product.id) ?? false,
      });
      if (!search.amount)
        log(
          `  Catalog unit ${JSON.stringify(product.unit)} is not a measurable size; comparing eligible packages without an amount constraint.`,
        );
      const result = await runSearch(search, {
        env,
        fetcher,
        makeClient,
        log,
        now,
      });
      const entry = {
        catalog_id: product.id,
        name: product.name,
        catalog_unit: product.unit,
        search,
        ...result,
      };
      report.results.push(entry);
      log(
        `[Catalog result] ${product.id}: ${result.products.length}/3 stores; ${result.products.filter((row) => row.source === "database").length} reused; ${result.rows.length} ${report.dryRun ? "searched" : "saved"}; ${result.complete ? "complete" : "partial"}.`,
      );
    } catch (error) {
      report.results.push({
        catalog_id: product.id,
        name: product.name,
        catalog_unit: product.unit,
        complete: false,
        error: error.message,
      });
      log(`[Catalog failed] ${product.id}: ${error.message}`);
    }
    // Save progress after each ID so completed writes remain reviewable after interruption.
    await checkpoint(report);
  }
  report.completed = report.results.filter((entry) => entry.complete).length;
  report.partial = report.results.filter(
    (entry) => !entry.complete && !entry.error,
  ).length;
  report.failed = report.results.filter((entry) => entry.error).length;
  report.finished_at = now().toISOString();
  await checkpoint(report);
  log(
    `\n[Catalog finished] ${report.total} IDs attempted: ${report.completed} complete, ${report.partial} partial, ${report.failed} failed.`,
  );
  return report;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const { values } = parseArgs({
      options: {
        "dry-run": { type: "boolean", default: false },
        lat: { type: "string" },
        lng: { type: "string" },
        zip: { type: "string" },
        report: { type: "string" },
        "refresh-only": { type: "string" },
        only: { type: "string" },
        "gluten-free": { type: "boolean" },
        vegan: { type: "boolean" },
        "nut-free": { type: "boolean" },
        help: { type: "boolean" },
      },
    });
    if (values.help)
      console.log(
        "Usage: node scripts/kroger-catalog.mjs [--dry-run] [--lat N --lng N | --zip ZIP] [--only ID,ID] [--refresh-only ID,ID] [--gluten-free] [--vegan] [--nut-free] [--report PATH]\nRuns the existing Kroger script for every products.id, saving winners to product/store. --refresh-only bypasses today's cache for the specified IDs.",
      );
    else {
      const require = createRequire(import.meta.url);
      createRequire(require.resolve("next/package.json"))(
        "@next/env",
      ).loadEnvConfig(fileURLToPath(new URL("../", import.meta.url)), true);
      if ((values.lat !== undefined) !== (values.lng !== undefined))
        throw new Error("Supply both --lat and --lng.");
      const reportPath = resolve(
        values.report ??
          `reports/kroger-catalog-${productDate(new Date())}.json`,
      );
      await mkdir(dirname(reportPath), { recursive: true });
      const report = await runCatalog(
        {
          dryRun: values["dry-run"],
          glutenFree: values["gluten-free"],
          vegan: values.vegan,
          nutFree: values["nut-free"],
          ...(values["refresh-only"]
            ? {
                refreshIds: values["refresh-only"]
                  .split(",")
                  .map((id) => id.trim()),
              }
            : {}),
          ...(values.only
            ? { productIds: values.only.split(",").map((id) => id.trim()) }
            : {}),
          ...(values.zip !== undefined ? { zip: values.zip } : {}),
          ...(values.lat !== undefined
            ? { origin: { latitude: values.lat, longitude: values.lng } }
            : {}),
        },
        {
          checkpoint: (report) =>
            writeFile(reportPath, JSON.stringify(report, null, 2) + "\n"),
        },
      );
      console.log(`[Catalog report] ${reportPath}`);
      if (report.completed !== report.total) process.exitCode = 2;
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exitCode = 1;
  }
}
