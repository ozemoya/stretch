// Shared Node.js implementation. Next.js callers use the server-only ./index entry point.
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

export function normalizeSearchOptions(options) {
  if (!options || typeof options !== "object")
    throw new Error("Supply Kroger search options.");
  const { zip, unit } = options;
  const item =
    typeof options.item === "string"
      ? options.item.trim().replace(/\s+/g, " ")
      : "";
  if (zip !== undefined && (typeof zip !== "string" || !/^\d{5}$/.test(zip)))
    throw new Error("Supply --zip with a five-digit US ZIP code.");
  if (!item || item.length < 2 || item.length > 60)
    throw new Error("Supply --item with a search of 2–60 characters.");
  if (unit !== undefined && !["fl-oz", "oz", "each"].includes(unit))
    throw new Error(
      "--unit must be fl-oz (volume), oz (weight), or each (count).",
    );
  const category =
    typeof options.category === "string" ? options.category.trim() : "";
  if (options.category !== undefined && (!category || category.length > 100))
    throw new Error(
      "--category must be a Kroger category name of 1–100 characters.",
    );
  if (options.origin !== undefined && zip !== undefined)
    throw new Error("Choose coordinates or --zip, not both.");
  const origin =
    options.origin !== undefined
      ? coordinates(options.origin?.latitude, options.origin?.longitude)
      : undefined;
  if (options.dryRun !== undefined && typeof options.dryRun !== "boolean")
    throw new Error("dryRun must be a boolean.");
  if (
    options.forceRefresh !== undefined &&
    typeof options.forceRefresh !== "boolean"
  )
    throw new Error("forceRefresh must be a boolean.");
  for (const flag of ["glutenFree", "vegan", "nutFree"])
    if (options[flag] !== undefined && typeof options[flag] !== "boolean")
      throw new Error(`${flag} must be a boolean.`);
  let amount;
  if (options.amount !== undefined) {
    const input =
      typeof options.amount === "string"
        ? options.amount.trim()
        : options.amount;
    if (
      typeof input === "number" ||
      (typeof input === "string" && /^\d+(?:\.\d+)?$/.test(input))
    ) {
      const dimension = unit ?? defaultComparisonUnit(item);
      if (!dimension)
        throw new Error(
          "Specify --unit for a numeric --amount, or include a unit such as --amount '12 ct'.",
        );
      amount = { unit: dimension, amount: Number(input) };
    } else if (typeof input === "string") {
      amount = parsePackageSize(input, unit ?? defaultComparisonUnit(item));
    } else if (input && typeof input === "object") {
      amount = { unit: input.unit, amount: input.amount };
    }
    if (
      !amount ||
      !["fl-oz", "oz", "each"].includes(amount.unit) ||
      !Number.isFinite(amount.amount) ||
      amount.amount <= 0
    )
      throw new Error(
        "--amount must be positive and measurable, such as '12 ct', '1 gal', or '16 oz'.",
      );
    if (unit && unit !== amount.unit)
      throw new Error(
        "--amount and --unit must use the same measurement dimension.",
      );
  }
  return {
    item,
    dryRun: options.dryRun ?? false,
    ...(options.forceRefresh ? { forceRefresh: true } : {}),
    ...Object.fromEntries(
      ["glutenFree", "vegan", "nutFree"]
        .filter((flag) => options[flag] === true)
        .map((flag) => [flag, true]),
    ),
    ...(zip !== undefined ? { zip } : {}),
    ...(origin ? { origin } : {}),
    ...(unit ? { unit } : {}),
    ...(category ? { category } : {}),
    ...(amount ? { amount } : {}),
  };
}

// Explicit read/write entry points, quiet unless the caller supplies a progress logger.
export function findCheapestKrogerProducts(options, dependencies = {}) {
  return run({ ...options, dryRun: true }, { log: () => {}, ...dependencies });
}

export function saveCheapestKrogerProducts(options, dependencies = {}) {
  return run({ ...options, dryRun: false }, { log: () => {}, ...dependencies });
}

export function distanceMiles(a, b) {
  const rad = (n) => (n * Math.PI) / 180;
  const h =
    Math.sin(rad(b.latitude - a.latitude) / 2) ** 2 +
    Math.cos(rad(a.latitude)) *
      Math.cos(rad(b.latitude)) *
      Math.sin(rad(b.longitude - a.longitude) / 2) ** 2;
  return 3958.7613 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}

function coordinates(latitude, longitude) {
  if (
    latitude === undefined ||
    longitude === undefined ||
    latitude === null ||
    longitude === null ||
    latitude === "" ||
    longitude === ""
  )
    throw new Error("Provider omitted location coordinates.");
  const point = { latitude: Number(latitude), longitude: Number(longitude) };
  if (
    !Number.isFinite(point.latitude) ||
    Math.abs(point.latitude) > 90 ||
    !Number.isFinite(point.longitude) ||
    Math.abs(point.longitude) > 180
  )
    throw new Error("Provider returned invalid coordinates.");
  return point;
}

export function nearestStores(raw, origin, radius) {
  if (!Array.isArray(raw.data))
    throw new Error("Kroger returned an invalid store list.");
  // Fail rather than guess nearest stores from a potentially truncated list.
  if (
    raw.data.length >= 200 ||
    (raw.meta?.pagination?.total ?? raw.meta?.total ?? 0) > raw.data.length
  )
    throw new Error(
      "Store results are incomplete; cannot reliably select the nearest three.",
    );
  const stores = new Map();
  for (const store of raw.data) {
    if (!store.locationId || !store.name)
      throw new Error("Kroger returned a store without an ID or name.");
    const point = coordinates(
      store.geolocation?.latitude,
      store.geolocation?.longitude,
    );
    const miles = distanceMiles(origin, point);
    if (miles <= radius)
      stores.set(store.locationId, { ...store, distance_miles: miles });
  }
  return [...stores.values()]
    .sort(
      (a, b) =>
        a.distance_miles - b.distance_miles ||
        a.locationId.localeCompare(b.locationId),
    )
    .slice(0, 3);
}

const cents = (price) =>
  typeof price === "number" &&
  Number.isFinite(price) &&
  price > 0 &&
  Number.isSafeInteger(Math.round(price * 100)) &&
  Math.round(price * 100) > 0
    ? Math.round(price * 100)
    : null;

const words = (value) =>
  String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu) ?? [];

// Kroger searches ingredients as well as product names. Require the requested
// words, then reject other food types for milk searches unless requested.
// These explicit rules are conservative, not a general semantic classifier.
const milkVariants = [
  ["yogurt", "yoghurt"],
  ["cheese", "mozzarella", "ricotta"],
  ["butter", "buttermilk"],
  ["ice cream", "gelato", "frozen dessert"],
  ["creamer", "whipping cream", "heavy cream"],
  ["powder", "powdered", "dry milk"],
  ["condensed", "evaporated"],
  ["formula", "toddler"],
  ["kefir", "shake", "shakes", "smoothie", "smoothies"],
  ["pudding", "custard", "candy", "cookies", "biscuit", "biscuits"],
  ["chocolate", "strawberry", "vanilla", "banana"],
  ["almond", "oat", "coconut", "soy", "cashew", "plant based"],
  ["goat", "goats", "sheep"],
];

export function matchesItem(product, searchTerm) {
  const queryWords = words(searchTerm);
  const descriptionWords = words(product.description);
  if (
    !queryWords.length ||
    !queryWords.every((word) => descriptionWords.includes(word))
  )
    return false;
  if (!queryWords.includes("milk")) return true;
  const query = ` ${queryWords.join(" ")} `;
  const description = ` ${descriptionWords.join(" ")} `;
  return milkVariants.every(
    (variants) =>
      !variants.some((variant) => description.includes(` ${variant} `)) ||
      variants.some((variant) => query.includes(` ${variant} `)),
  );
}

export function productCategories(product) {
  if (!Array.isArray(product.categories)) return [];
  const labels = new Map();
  for (const label of product.categories) {
    if (typeof label !== "string" || !label.trim()) continue;
    labels.set(label.trim().toLowerCase(), label.trim());
  }
  return [...labels.values()];
}

export function chooseCategory(products, searchTerm, requestedCategory) {
  if (requestedCategory) return requestedCategory.trim();
  const counts = new Map();
  for (const product of products.filter((product) =>
    matchesItem(product, searchTerm),
  )) {
    for (const label of productCategories(product)) {
      // This merchandising label is shared by unrelated organic foods.
      if (label.toLowerCase() === "natural & organic") continue;
      const key = label.toLowerCase();
      const entry = counts.get(key) ?? { label, count: 0 };
      entry.count++;
      counts.set(key, entry);
    }
  }
  const ranked = [...counts.values()].sort(
    (a, b) => b.count - a.count || a.label.localeCompare(b.label),
  );
  if (!ranked.length) return null;
  if (ranked[1]?.count === ranked[0].count)
    throw new Error(
      `Category is ambiguous (${ranked
        .filter((entry) => entry.count === ranked[0].count)
        .map((entry) => entry.label)
        .join(", ")}). Supply --category with the intended Kroger category.`,
    );
  return ranked[0].label;
}

export function matchesCategory(product, category) {
  return (
    !!category &&
    productCategories(product).some(
      (label) => label.toLowerCase() === category.toLowerCase(),
    )
  );
}

const dietaryColumns = {
  glutenFree: "gluten_free",
  vegan: "vegan",
  nutFree: "nut_free",
};
const dietaryLabels = {
  glutenFree: "gluten free",
  vegan: "vegan",
  nutFree: "nut free",
};

// The compact Products API provides a description, not a complete dietary/allergen record.
// Record explicit product-name claims only; absence of a claim is unknown, not false.
export function dietaryFlags(product) {
  const tokens = words(product.description);
  const claim = (label) => {
    const target = label.split(" ");
    let positive = false;
    let negative = false;
    for (let i = 0; i <= tokens.length - target.length; i++) {
      if (!target.every((word, j) => tokens[i + j] === word)) continue;
      // Peanut-free or tree-nut-free alone does not establish freedom from all nuts.
      if (label === "nut free" && ["tree", "peanut"].includes(tokens[i - 1]))
        continue;
      if (
        ["not", "non", "no"].includes(tokens[i - 1]) ||
        (["a", "an", "certified", "necessarily"].includes(tokens[i - 1]) &&
          ["not", "non", "no"].includes(tokens[i - 2]))
      )
        negative = true;
      else positive = true;
    }
    return negative ? false : positive ? true : null;
  };
  return {
    gluten_free: claim("gluten free"),
    vegan: claim("vegan"),
    nut_free: claim("nut free"),
  };
}

export function matchesDietary(flags, filters = {}) {
  return Object.entries(dietaryColumns).every(
    ([option, column]) => filters[option] !== true || flags[column] === true,
  );
}

// US customary units. Never treat weight ounces as fluid ounces.
const sizeUnits = {
  "fl oz": ["fl-oz", 1],
  "fluid ounce": ["fl-oz", 1],
  "fluid ounces": ["fl-oz", 1],
  gal: ["fl-oz", 128],
  gallon: ["fl-oz", 128],
  gallons: ["fl-oz", 128],
  qt: ["fl-oz", 32],
  quart: ["fl-oz", 32],
  quarts: ["fl-oz", 32],
  pt: ["fl-oz", 16],
  pint: ["fl-oz", 16],
  pints: ["fl-oz", 16],
  l: ["fl-oz", 1000 / 29.5735295625],
  liter: ["fl-oz", 1000 / 29.5735295625],
  liters: ["fl-oz", 1000 / 29.5735295625],
  ml: ["fl-oz", 1 / 29.5735295625],
  oz: ["oz", 1],
  ounce: ["oz", 1],
  ounces: ["oz", 1],
  lb: ["oz", 16],
  lbs: ["oz", 16],
  pound: ["oz", 16],
  pounds: ["oz", 16],
  g: ["oz", 1 / 28.349523125],
  kg: ["oz", 1000 / 28.349523125],
  ct: ["each", 1],
  count: ["each", 1],
  each: ["each", 1],
  dozen: ["each", 12],
};

export function parsePackageSize(size, requestedUnit) {
  if (typeof size !== "string") return null;
  let value = size
    .toLowerCase()
    .replace(/½/g, " 1/2")
    .replace(/¼/g, " 1/4")
    .replace(/¾/g, " 3/4")
    .replace(/\bhalf\b/g, "0.5")
    .replace(/\bquarter\b/g, "0.25")
    .replace(/(?<=[a-z])\./g, "")
    .replace(/\s+/g, " ")
    .trim();
  let multiplier = 1;
  // Dual count/weight labels give item count and total package weight, not count times weight.
  const countedWeight = value.match(
    /^(\d+)\s*(?:ct|count)\s*\/\s*\d+(?:\.\d+)?\s*(?:oz|lb|g|kg)$/,
  );
  if (requestedUnit === "each" && countedWeight && Number(countedWeight[1]) > 0)
    return { unit: "each", amount: Number(countedWeight[1]) };
  if (countedWeight)
    return parsePackageSize(
      value.replace(/^\d+\s*(?:ct|count)\s*\/\s*/, ""),
      requestedUnit,
    );
  const pack = value.match(
    /^(\d+)\s*(?:(?:ct|count|pk|pack)\s*\/\s*|(?:pk|pack)\s+|x\s*)(.+)$/,
  );
  if (pack) {
    multiplier = Number(pack[1]);
    value = pack[2];
  }
  const match = value.match(
    /^(\d+(?:\.\d+)?(?:\s+\d+\/\d+|\/\d+)?)\s*([a-z]+(?:\s+[a-z]+)?)$/,
  );
  if (!match || !sizeUnits[match[2]]) return null;
  // Accept common reduced fractions; a label like "6/8 fl oz" may instead
  // mean six 8-oz cartons, so don't guess its package quantity.
  const fraction = match[1].match(/\d+\/\d+/)?.[0];
  if (
    fraction &&
    !["1/2", "1/4", "3/4", "1/8", "3/8", "5/8", "7/8"].includes(fraction)
  )
    return null;
  const quantity = match[1].split(" ").reduce((total, part) => {
    const [numerator, denominator = "1"] = part.split("/");
    return total + Number(numerator) / Number(denominator);
  }, 0);
  const [unit, factor] = sizeUnits[match[2]];
  const amount = quantity * multiplier * factor;
  return Number.isFinite(amount) && amount > 0 ? { unit, amount } : null;
}

// Count physical items separately from the weight/volume used for unit pricing.
export function parsePackageCount(size, requestedUnit) {
  const measured = parsePackageSize(size, requestedUnit);
  if (!measured) return null;
  if (measured.unit === "each")
    return Number.isSafeInteger(measured.amount) ? measured.amount : null;
  const pack = size
    .toLowerCase()
    .replace(/(?<=[a-z])\./g, "")
    .replace(/\s+/g, " ")
    .trim()
    .match(/^(\d+)\s*(?:(?:ct|count|pk|pack)\s*\/\s*|(?:pk|pack)\s+|x\s*)/);
  const count = pack ? Number(pack[1]) : 1;
  return Number.isSafeInteger(count) && count > 0 ? count : null;
}

function defaultComparisonUnit(searchTerm) {
  const query = ` ${words(searchTerm).join(" ")} `;
  if (
    query.includes(" eggs ") &&
    !["liquid", "whites", "powder", "substitute"].some((word) =>
      query.includes(` ${word} `),
    )
  )
    return "each";
  // Plain drinking milk is measured by volume. Other item searches infer their
  // basis only when all eligible sizes share one dimension.
  return query.includes(" milk ") &&
    !milkVariants.some((variants) =>
      variants.some((variant) => query.includes(` ${variant} `)),
    )
    ? "fl-oz"
    : undefined;
}

export function cheapestPackage(
  products,
  searchTerm,
  requestedUnit,
  log = () => {},
  requestedCategory,
  requestedAmount,
  dietary = {},
) {
  const unit =
    requestedUnit ?? requestedAmount?.unit ?? defaultComparisonUnit(searchTerm);
  const category = chooseCategory(
    products.filter((product) =>
      matchesDietary(dietaryFlags(product), dietary),
    ),
    searchTerm,
    requestedCategory,
  );
  products = products.filter(
    (product) =>
      matchesItem(product, searchTerm) &&
      matchesCategory(product, category) &&
      matchesDietary(dietaryFlags(product), dietary),
  );
  let skippedSizes = 0;
  let skippedAmounts = 0;
  const candidates = products.flatMap((product) =>
    (product.items ?? []).flatMap((item) => {
      const price = cents(item.price?.regular);
      if (
        !product.productId ||
        !product.description ||
        !item.itemId ||
        item.soldBy !== "UNIT" ||
        price === null ||
        item.inventory?.stockLevel === "TEMPORARILY_OUT_OF_STOCK"
      )
        return [];
      const size = parsePackageSize(item.size, unit);
      const packageCount = parsePackageCount(item.size, unit);
      if (!size || !packageCount || (unit && size.unit !== unit)) {
        skippedSizes++;
        return [];
      }
      if (
        requestedAmount &&
        (size.unit !== requestedAmount.unit ||
          Math.abs(size.amount - requestedAmount.amount) >
            requestedAmount.amount / 3 + requestedAmount.amount * 1e-9)
      ) {
        skippedAmounts++;
        return [];
      }
      return [
        {
          product_id: product.productId,
          item_id: item.itemId,
          description: product.description,
          ...dietaryFlags(product),
          brand: product.brand ?? null,
          upc: product.upc ?? null,
          package_size: item.size ?? null,
          sold_by: item.soldBy,
          regular_price_cents: price,
          promo_price_cents: cents(item.price?.promo),
          comparison_unit: size.unit,
          package_quantity: size.amount,
          package_count: packageCount,
          unit_price_cents: price / size.amount,
          price_basis: "unit",
          matched_category: productCategories(product).find(
            (label) => label.toLowerCase() === category.toLowerCase(),
          ),
          provider_categories: productCategories(product),
        },
      ];
    }),
  );
  log(
    `  Unit pricing: ${candidates.length} eligible packages; ${skippedSizes} skipped for unknown or incompatible sizes; ${skippedAmounts} skipped outside the allowed package range.`,
  );
  let rankedCandidates = candidates;
  if (requestedAmount) {
    const exact = candidates.filter(
      (candidate) =>
        Math.abs(candidate.package_quantity - requestedAmount.amount) <=
        requestedAmount.amount * 1e-9,
    );
    if (exact.length) rankedCandidates = exact;
    log(
      `  Package size: ${exact.length ? `${exact.length} exact matches; choosing their lowest unit price` : "no eligible exact match; choosing the lowest unit price in the fallback range"}.`,
    );
  }
  if (
    new Set(candidates.map((candidate) => candidate.comparison_unit)).size > 1
  )
    throw new Error(
      "Matches mix volume, weight, or count. Choose --unit fl-oz, oz, or each; these cannot be ranked together.",
    );
  return (
    rankedCandidates.sort(
      (a, b) =>
        a.unit_price_cents - b.unit_price_cents ||
        a.regular_price_cents - b.regular_price_cents ||
        a.product_id.localeCompare(b.product_id) ||
        a.item_id.localeCompare(b.item_id),
    )[0] ?? null
  );
}

async function requestJson(fetcher, url, init, label) {
  let response;
  try {
    response = await fetcher(url, {
      ...init,
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new Error(`${label}: network request failed or timed out.`);
  }
  if (!response.ok)
    throw new Error(
      `${label}: HTTP ${response.status}${response.status === 429 ? " (rate limited; try again later)" : ""}.`,
    );
  try {
    return await response.json();
  } catch {
    throw new Error(`${label}: invalid JSON response.`);
  }
}

export async function resolveOrigin(options, fetcher, log) {
  if (options.origin) {
    const point = coordinates(
      options.origin.latitude,
      options.origin.longitude,
    );
    log("  Using supplied coordinates.");
    return point;
  }
  if (options.zip) {
    const geo = await requestJson(
      fetcher,
      `https://api.zippopotam.us/us/${options.zip}`,
      {},
      "ZIP lookup",
    );
    log(`  Using representative point for ZIP ${options.zip}.`);
    return coordinates(geo.places?.[0]?.latitude, geo.places?.[0]?.longitude);
  }
  for (const provider of ["https://ipapi.co/json/", "https://ipwho.is/"]) {
    try {
      const geo = await requestJson(
        fetcher,
        provider,
        {},
        "IP location lookup",
      );
      if (geo.error || geo.success === false)
        throw new Error("Provider could not resolve the current IP.");
      const point = coordinates(geo.latitude, geo.longitude);
      log(
        `  Approximate IP location: ${[geo.city, geo.region, geo.country_name ?? geo.country].filter(Boolean).join(", ") || "unnamed area"} (${point.latitude.toFixed(4)}, ${point.longitude.toFixed(4)}), via ${new URL(provider).hostname}. VPNs and proxies can change this location.`,
      );
      return point;
    } catch (error) {
      log(`  ${new URL(provider).hostname}: ${error.message}`);
    }
  }
  throw new Error(
    "IP location lookup failed with both providers. Retry or supply --lat and --lng.",
  );
}

export function splitStoreName(name) {
  const branch = String(name ?? "")
    .trim()
    .replace(/^kroger(?:\s*[-–—]\s*|\s+|$)/i, "")
    .replace(/\s+kroger$/i, "")
    .trim();
  return { store: "Kroger", "sub-location": branch || null };
}

export function productID(
  searchTerm,
  locationId,
  requestedAmount,
  dietary = {},
) {
  if (!/^\d+$/.test(locationId) || !Number.isSafeInteger(Number(locationId)))
    throw new Error(
      "Kroger location ID cannot be represented by product.locationID.",
    );
  const item = searchTerm.trim().toLowerCase().replace(/\s+/g, " ");
  return Number.parseInt(
    createHash("sha256")
      .update(
        JSON.stringify([
          "kroger",
          item,
          locationId,
          ...(requestedAmount
            ? [
                requestedAmount.unit,
                Number(requestedAmount.amount.toPrecision(12)),
              ]
            : []),
          ...(Object.keys(dietaryColumns).some((flag) => dietary[flag] === true)
            ? [
                "dietary",
                ...Object.entries(dietaryColumns)
                  .filter(([flag]) => dietary[flag] === true)
                  .map(([, column]) => column),
              ]
            : []),
        ]),
      )
      .digest("hex")
      .slice(0, 13),
    16,
  );
}

export function productRow(result) {
  const ID = productID(
    result.search_term,
    result.location_id,
    result.requested_amount,
    result.requested_dietary,
  );
  const item = result.search_term.trim().toLowerCase().replace(/\s+/g, " ");
  if (!Number.isSafeInteger(result.package_count) || result.package_count <= 0)
    throw new Error(
      "The number of individual items must be a positive whole number for product.count.",
    );
  return {
    ID,
    category: item,
    count: result.package_count,
    price: result.regular_price_cents / 100,
    unit_price: result.unit_price_cents / 100,
    locationID: Number(result.location_id),
    location_key: `kroger:branch:${BigInt(result.location_id)}`,
    date: productDate(result.retrieved_at ?? new Date()),
    ...Object.fromEntries(
      Object.values(dietaryColumns).map((column) => [
        column,
        typeof result[column] === "boolean" ? result[column] : null,
      ]),
    ),
  };
}

// Calendar-day freshness follows the application's Eastern time zone, not host time or 24-hour age.
export function productDate(value) {
  const instant = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(instant.getTime()))
    throw new Error("Product retrieval date is invalid.");
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const part = (type) => parts.find((entry) => entry.type === type).value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function storeRow(result) {
  const location = Number(result.location_id);
  if (!/^\d+$/.test(result.location_id) || !Number.isSafeInteger(location))
    throw new Error(
      "Kroger location ID cannot be represented by store.locationID.",
    );
  const point = result.store_geolocation
    ? coordinates(
        result.store_geolocation.latitude,
        result.store_geolocation.longitude,
      )
    : null;
  const clean = (value) => (typeof value === "string" ? value.trim() : "");
  const address = result.store_address ?? {};
  return {
    locationID: location,
    location_key: `kroger:branch:${BigInt(result.location_id)}`,
    retailer_key: "kroger",
    location_scope: "branch",
    source_location_id: BigInt(result.location_id).toString(),
    ...splitStoreName(result.store_name),
    latitude: point?.latitude ?? null,
    longitude: point?.longitude ?? null,
    address:
      [
        clean(address.addressLine1),
        clean(address.addressLine2),
        clean(address.city),
        [clean(address.state), clean(address.zipCode)]
          .filter(Boolean)
          .join(" "),
      ]
        .filter(Boolean)
        .join(", ") || null,
  };
}

export async function searchProducts(get, locationId, item, log) {
  const products = new Map();
  let start = 0;
  for (let page = 1; page <= 100; page++) {
    const raw = await get("products", {
      "filter.locationId": locationId,
      "filter.term": item,
      "filter.fulfillment": "ais",
      "filter.limit": "50",
      "filter.start": String(start),
    });
    if (!Array.isArray(raw.data))
      throw new Error("Kroger returned an invalid product list.");
    const before = products.size;
    for (const p of raw.data) {
      if (!p.productId || !Array.isArray(p.items))
        throw new Error("Kroger returned an invalid product.");
      products.set(p.productId, p);
    }
    log(
      `  Page ${page}: ${raw.data.length} products (${products.size} unique so far).`,
    );
    start += raw.data.length;
    const total = raw.meta?.pagination?.total;
    if (
      Number.isInteger(total) && total >= 0
        ? start >= total
        : raw.data.length < 50
    )
      return [...products.values()];
    // Kroger rejects filter.start > 250. A 50-product page at that offset
    // exposes at most 300 results even if metadata reports more matches.
    if (start > 250) {
      log(
        `  SEARCH LIMITED: Kroger exposes at most 300 results for this query${Number.isInteger(total) ? ` (${total} matches reported)` : ""}. Ranking only the ${products.size} returned products.`,
      );
      return Object.assign([...products.values()], { searchLimited: true });
    }
    if (products.size === before)
      throw new Error(
        "Product pagination stopped progressing; no incomplete minimum will be saved.",
      );
  }
  throw new Error(
    "Search exceeded 100 pages; narrow --item. No incomplete minimum will be saved.",
  );
}

export async function run(
  options,
  {
    env = process.env,
    fetcher = fetch,
    log = console.log,
    makeClient = createClient,
    now = () => new Date(),
  } = {},
) {
  options = normalizeSearchOptions(options);
  const { zip, item, dryRun } = options;
  const requiredDietary = Object.keys(dietaryColumns).filter(
    (flag) => options[flag] === true,
  );
  const productColumns =
    "ID,category,count,price,unit_price,locationID,location_key,date,gluten_free,vegan,nut_free";
  log(
    `[1/5] Checking configuration for ${JSON.stringify(item)} using ${zip ? `ZIP ${zip}` : options.origin ? "supplied coordinates" : "current approximate IP location"}.`,
  );
  if (options.amount)
    log(
      `  Preferred package amount: ${options.amount.amount} ${options.amount.unit}; fallback range ${(options.amount.amount * 2) / 3}–${(options.amount.amount * 4) / 3} ${options.amount.unit}.`,
    );
  if (requiredDietary.length)
    log(
      `  Required dietary labels: ${requiredDietary.map((flag) => dietaryLabels[flag]).join(", ")}. Products without every explicit claim are excluded.`,
    );
  const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    env.SUPABASE_SECRET_KEY ||
    env.SUPABASE_SERVICE_ROLE_KEY ||
    (dryRun &&
      (env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
        env.NEXT_PUBLIC_SUPABASE_ANON_KEY));
  const missing = [
    !env.KROGER_CLIENT_ID && "KROGER_CLIENT_ID",
    !env.KROGER_CLIENT_SECRET && "KROGER_CLIENT_SECRET",
    !url && "SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)",
    !key &&
      (dryRun
        ? "a Supabase read key (publishable, anon or server key)"
        : "SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY)"),
  ].filter(Boolean);
  if (missing.length)
    throw new Error(`Missing ${missing.join(", ")}. Set them in .env.local.`);
  const db = makeClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) =>
        fetcher(input, { ...init, signal: AbortSignal.timeout(20000) }),
    },
  });
  if (db) {
    const { error } = await db.from("product").select(productColumns).limit(0);
    if (error) {
      if (["42703", "PGRST204"].includes(error.code))
        throw new Error(
          "The product table is missing required columns: ID, category, count, price, unit_price, location_key, date, gluten_free, vegan, nut_free. Apply the product_date, product_dietary, modular_scraper_prices, and store_location_key migrations.",
        );
      if (["PGRST205", "42P01"].includes(error.code))
        throw new Error(
          "Supabase is reachable, but the existing product table was not found.",
        );
      throw new Error(
        "Cannot access product. Check the Supabase server key and table permissions.",
      );
    }
    const storeCheck = await db
      .from("store")
      .select("location_key,locationID,store,sub-location,latitude,longitude,address")
      .limit(0);
    if (storeCheck.error)
      throw new Error(
        "Cannot access the store table or its metadata columns. Apply the product_store and store_metadata migrations and check the server key permissions.",
      );
  }
  log("[2/5] Resolving current location and authenticating with Kroger.");
  let token,
    expires = 0;
  const get = async (path, params) => {
    if (Date.now() >= expires) {
      const auth = await requestJson(
        fetcher,
        "https://api.kroger.com/v1/connect/oauth2/token",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: `Basic ${Buffer.from(`${env.KROGER_CLIENT_ID}:${env.KROGER_CLIENT_SECRET}`).toString("base64")}`,
          },
          body: new URLSearchParams({
            grant_type: "client_credentials",
            scope: "product.compact",
          }).toString(),
        },
        "Kroger authentication",
      );
      if (
        typeof auth.access_token !== "string" ||
        !Number.isFinite(auth.expires_in) ||
        auth.expires_in <= 0
      )
        throw new Error("Kroger returned invalid authentication data.");
      token = auth.access_token;
      expires = Date.now() + Math.max(0, auth.expires_in - 60) * 1000;
    }
    return requestJson(
      fetcher,
      `https://api.kroger.com/v1/${path}?${new URLSearchParams(params)}`,
      { headers: { Authorization: `Bearer ${token}` } },
      `Kroger ${path}`,
    );
  };
  const origin = await resolveOrigin(options, fetcher, log);
  log(
    "[3/5] Finding stores and sorting by straight-line distance from the selected location.",
  );
  let stores = [];
  for (const radius of [10, 25, 50, 100]) {
    const raw = await get("locations", {
      "filter.latLong.near": `${origin.latitude},${origin.longitude}`,
      "filter.radiusInMiles": String(radius),
      "filter.chain": "KROGER",
      "filter.limit": "200",
    });
    stores = nearestStores(raw, origin, radius);
    log(
      `  ${radius}-mile search: ${raw.data.length} locations returned; ${stores.length} selected.`,
    );
    if (stores.length === 3) break;
  }
  if (stores.length < 3)
    log(
      `  Only ${stores.length} stores found within 100 miles; fewer than three results are possible.`,
    );
  const rows = [];
  const cached = new Map();
  const today = productDate(now());
  if (stores.length) {
    log(
      "  Checking Supabase for the same item, store and requested amount before searching products.",
    );
    const existing = await db
      .from("product")
      .select(productColumns)
      .in(
        "ID",
        stores.map((store) =>
          productID(item, store.locationId, options.amount, options),
        ),
      );
    if (existing.error)
      throw new Error(
        "Could not check saved products; no Kroger product searches performed.",
      );
    for (const row of existing.data ?? []) {
      const store = stores.find(
        (store) =>
          productID(item, store.locationId, options.amount, options) ===
          Number(row.ID),
      );
      if (
        !store ||
        row.category !== item.toLowerCase() ||
        row.location_key !== `kroger:branch:${BigInt(store.locationId)}`
      )
        throw new Error(
          "A saved product ID conflicts with this search; no Kroger product searches performed.",
        );
      // Undated historical records and older calendar days must be searched again.
      if (
        options.forceRefresh ||
        !row.date ||
        row.date < today ||
        !matchesDietary(row, options)
      ) {
        log(
          `  REFRESH NEEDED: product ${row.ID} was last updated ${row.date ?? "on an unknown date"}; today is ${today}.${options.forceRefresh ? " Explicit refresh requested to correct a prior match." : ""}${!matchesDietary(row, options) ? " Saved dietary flags do not satisfy this search." : ""}`,
        );
        continue;
      }
      if (row.date !== today)
        throw new Error(
          "A saved product has an invalid or future date; repair it before searching again.",
        );
      const product = {
        ID: Number(row.ID),
        category: row.category,
        count: Number(row.count),
        price: Number(row.price),
        unit_price: Number(row.unit_price),
        locationID: Number(row.locationID),
        location_key: row.location_key,
        date: row.date,
        ...Object.fromEntries(
          Object.values(dietaryColumns).map((column) => [
            column,
            typeof row[column] === "boolean" ? row[column] : null,
          ]),
        ),
      };
      if (
        !Number.isSafeInteger(product.count) ||
        product.count <= 0 ||
        !Number.isFinite(product.price) ||
        product.price <= 0 ||
        !Number.isFinite(product.unit_price) ||
        product.unit_price <= 0
      )
        throw new Error(
          "A saved product has an invalid count or price; repair it before searching again.",
        );
      cached.set(store.locationId, product);
    }
  }
  const issues = [];
  if (stores.length < 3)
    issues.push({
      kind: "fewer-stores",
      message: `Only ${stores.length} Kroger stores found within 100 miles.`,
    });
  let failures = 0;
  let limitedSearches = 0;
  let selectedCategory = options.category;
  log(
    "[4/5] Reusing today's saved products; searching missing or outdated stores and comparing regular prices per unit.",
  );
  for (const [index, store] of stores.entries()) {
    log(
      `  Store ${index + 1}/${stores.length}: ${store.name} (${store.locationId}), ${store.distance_miles.toFixed(2)} miles.`,
    );
    if (cached.has(store.locationId)) {
      log(
        `  DATABASE HIT: using saved product ${cached.get(store.locationId).ID}; Kroger product search skipped.`,
      );
      continue;
    }
    try {
      const searchTerm = [
        item,
        ...requiredDietary.map((flag) => dietaryLabels[flag]),
      ].join(" ");
      const products = await searchProducts(
        get,
        store.locationId,
        searchTerm,
        log,
      );
      if (products.searchLimited) {
        limitedSearches++;
        issues.push({
          kind: "search-limited",
          locationId: store.locationId,
          message:
            "Kroger capped this query at 300 products; the winner is limited to returned products.",
        });
      }
      selectedCategory ??= chooseCategory(
        products.filter((product) =>
          matchesDietary(dietaryFlags(product), options),
        ),
        item,
      );
      log(
        `  Kroger category: ${selectedCategory ?? "none found; products without categories cannot be verified"}.`,
      );
      const excluded = products.filter(
        (product) =>
          !matchesCategory(product, selectedCategory) ||
          !matchesItem(product, item) ||
          !matchesDietary(dietaryFlags(product), options),
      );
      log(
        `  Matching: ${products.length - excluded.length}/${products.length} products accepted; ${excluded.length} unrelated or unrequested variants excluded.`,
      );
      if (excluded.length)
        log(
          `  Excluded examples: ${excluded
            .slice(0, 3)
            .map((product) => product.description)
            .join(" | ")}`,
        );
      const best = cheapestPackage(
        products,
        item,
        options.unit,
        log,
        selectedCategory,
        options.amount,
        options,
      );
      if (!best) {
        issues.push({
          kind: "no-match",
          locationId: store.locationId,
          message:
            "No eligible unit-priced package matched this item, category, amount and required dietary labels.",
        });
        log(
          "  SKIPPED: no eligible unit-priced packages matched. Unknown/incompatible sizes and weighted/unpriced/out-of-stock items are excluded.",
        );
        continue;
      }
      log(
        `  Lowest unit price: ${best.description} | ${best.package_size} | $${(best.regular_price_cents / 100).toFixed(2)} per package | $${(best.unit_price_cents / 100).toFixed(4)}/${best.comparison_unit}${best.comparison_unit === "fl-oz" ? ` ($${((best.unit_price_cents * 128) / 100).toFixed(2)}/gallon)` : ""}.`,
      );
      log(`  Package count: ${best.package_count} individual item(s).`);
      rows.push({
        search_term: item,
        requested_amount: options.amount,
        requested_dietary: Object.fromEntries(
          requiredDietary.map((flag) => [flag, true]),
        ),
        search_zip: zip,
        location_id: store.locationId,
        store_name: store.name,
        store_address: store.address ?? {},
        store_geolocation: store.geolocation,
        distance_miles: store.distance_miles,
        store_rank: index + 1,
        ...best,
        retrieved_at: now().toISOString(),
      });
    } catch (error) {
      failures++;
      issues.push({
        kind: "store-search-failed",
        locationId: store.locationId,
        message: error.message,
      });
      log(`  FAILED: ${error.message}`);
    }
  }
  log(
    `[5/5] ${dryRun ? "Dry run: would save" : "Saving"} ${rows.length} winner(s) to Supabase product.`,
  );
  if (!dryRun && rows.length) {
    const savedRows = rows.map(productRow);
    const savedStores = [
      ...new Map(
        rows.map((row) => {
          const mapped = storeRow(row);
          return [mapped.location_key, mapped];
        }),
      ).values(),
    ];
    const existing = await db
      .from("product")
      .select("ID,category,location_key")
      .in(
        "ID",
        savedRows.map((row) => row.ID),
      );
    if (existing.error)
      throw new Error("Could not check existing product rows before saving.");
    for (const row of existing.data ?? []) {
      const intended = savedRows.find(
        (candidate) => candidate.ID === Number(row.ID),
      );
      if (
        !intended ||
        row.category !== intended.category ||
        row.location_key !== intended.location_key
      )
        throw new Error(
          "A product ID conflicts with an unrelated existing row; no winners saved.",
        );
    }
    const storeSave = await db
      .from("store")
      .upsert(savedStores, { onConflict: "location_key" })
      .select("location_key,locationID,store,sub-location,latitude,longitude,address");
    if (storeSave.error || storeSave.data?.length !== savedStores.length)
      throw new Error(
        "Supabase did not confirm the store save; no product winners were saved.",
      );
    log(`  Saved ${storeSave.data.length} stores, linked by location_key.`);
    const { data, error } = await db
      .from("product")
      .upsert(savedRows, { onConflict: "ID" })
      .select(productColumns);
    if (error || data?.length !== rows.length)
      throw new Error(
        "Supabase did not confirm the product save. Retry safely using the same item and amount; IDs are stable per item, store, and requested amount.",
      );
    log(
      `  Saved ${data.length} product rows (one per item/store/requested amount). IDs: ${data.map((row) => row.ID).join(", ")}`,
    );
  }
  const products = stores.flatMap((store) => {
    const fresh = rows.find((row) => row.location_id === store.locationId);
    const product =
      cached.get(store.locationId) ?? (fresh ? productRow(fresh) : null);
    if (!product) return [];
    return [
      {
        ...product,
        source: fresh ? "kroger" : "database",
        store: storeRow({
          location_id: store.locationId,
          store_name: store.name,
          store_geolocation: store.geolocation,
          store_address: store.address,
        }),
      },
    ];
  });
  const complete =
    stores.length === 3 &&
    products.length === 3 &&
    failures === 0 &&
    limitedSearches === 0;
  log(
    `${complete ? "Complete" : "Partial result"}: ${products.length}/${stores.length} stores with prices (${cached.size} reused, ${rows.length} searched); ${failures} failed searches; ${limitedSearches} searches limited by Kroger's pagination cap.${dryRun ? " No database writes performed." : ""}`,
  );
  return { rows, products, complete, issues };
}
