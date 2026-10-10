import { parseSize } from "./package-match";

export type ImageType = "retailer" | "manufacturer" | "licensed_reference" | "generic_illustration";
export type ProductImageMetadata = {
  imageUrl: string | null;
  imageSource: string;
  imageSourceUrl: string | null;
  imageType: ImageType;
  imageLicense: string | null;
  imageAttribution: string | null;
  imageMatchConfidence: number;
  imageVerifiedAt: string;
};
export type ImageQuery = { productName: string; brand?: string; size?: string; upc?: string };
export type FoodFactsProduct = { code?: string; product_name?: string; brands?: string; quantity?: string; image_front_url?: string };

export function genericImage(verifiedAt = new Date().toISOString()): ProductImageMetadata {
  return { imageUrl: null, imageSource: "Stretch illustration", imageSourceUrl: null,
    imageType: "generic_illustration", imageLicense: null, imageAttribution: null,
    imageMatchConfidence: 0, imageVerifiedAt: verifiedAt };
}

function words(value: string) {
  return value.toLowerCase().replace(/\b\d+(?:\.\d+)?\s*(?:fl\s*)?(?:oz|lb|lbs|ct|count|gallon|gal|ml|l|kg|g)\b/g, " ")
    .match(/[a-z0-9]+/g) ?? [];
}
function sameSize(expected: string, actual: string) {
  const a = parseSize(expected), b = parseSize(actual);
  return !!a && !!b && a.kind === b.kind && Math.abs(a.amount - b.amount) <= a.amount * 0.02;
}
export function safeFoodFactsImage(url: string | undefined) {
  try {
    const parsed = new URL(url ?? "");
    return parsed.protocol === "https:" && parsed.hostname === "images.openfoodfacts.org" &&
      parsed.pathname.startsWith("/images/products/") ? parsed.href : null;
  } catch { return null; }
}

/** Strict metadata gate; an LLM may reject an image, but cannot override these conflicts. */
export function matchFoodFactsImage(query: ImageQuery, product: FoodFactsProduct): number {
  if (!safeFoodFactsImage(product.image_front_url)) return 0;
  const expectedCode = query.upc?.replace(/\D/g, "");
  const actualCode = product.code?.replace(/\D/g, "");
  if (expectedCode && expectedCode !== actualCode) return 0;
  if (query.brand) {
    const brand = words(query.brand).join(" ");
    const actualBrands = (product.brands ?? "").split(/[,;]/).map((entry) => words(entry).join(" "));
    if (!brand || !actualBrands.some((entry) => entry === brand)) return 0;
  }
  if (query.size && product.quantity && !sameSize(query.size, product.quantity)) return 0;
  if (query.size && !product.quantity && !expectedCode) return 0;
  const brandWords = new Set(words(query.brand ?? ""));
  const expected = words(query.productName).filter((word) => !brandWords.has(word));
  const actual = words(product.product_name ?? "").filter((word) => !brandWords.has(word));
  const overlap = expected.filter((word) => actual.includes(word)).length;
  if (expectedCode) return overlap >= Math.min(1, expected.length) ? 0.98 : 0;
  // A broad category such as "milk" cannot establish a specific product photo.
  if (expected.length < 2 || actual.length < 2) return 0;
  if (overlap !== expected.length || actual.some((word) => !expected.includes(word))) return 0;
  return 0.9;
}

export function foodFactsImage(query: ImageQuery, product: FoodFactsProduct,
  verifiedAt = new Date().toISOString()): ProductImageMetadata | null {
  const confidence = matchFoodFactsImage(query, product);
  const imageUrl = safeFoodFactsImage(product.image_front_url);
  if (!confidence || !imageUrl || !product.code) return null;
  return { imageUrl, imageSource: "Open Food Facts", imageSourceUrl: `https://world.openfoodfacts.org/product/${encodeURIComponent(product.code)}`,
    imageType: "licensed_reference", imageLicense: "Creative Commons Attribution ShareAlike",
    imageAttribution: "Product image © Open Food Facts contributors · CC BY-SA",
    imageMatchConfidence: confidence, imageVerifiedAt: verifiedAt };
}
