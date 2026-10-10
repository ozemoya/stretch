import { expect, it } from "vitest";
import { foodFactsImage, genericImage, matchFoodFactsImage, safeFoodFactsImage } from "../lib/product-image";

const source = { code: "0016000124790", product_name: "Honey Nut Cheerios", brands: "General Mills",
  quantity: "10.8 oz", image_front_url: "https://images.openfoodfacts.org/images/products/001/600/012/4790/front_en.139.400.jpg" };
const query = { productName: "Honey Nut Cheerios", brand: "General Mills", size: "10.8 oz" };

it("accepts a matching licensed reference with source and attribution", () => {
  const image = foodFactsImage(query, source, "2026-10-10T12:00:00Z");
  expect(image?.imageType).toBe("licensed_reference");
  expect(image?.imageSourceUrl).toContain("openfoodfacts.org/product/0016000124790");
  expect(image?.imageAttribution).toContain("CC BY-SA");
  expect(image?.imageVerifiedAt).toBe("2026-10-10T12:00:00Z");
});

it("rejects conflicting brands, package sizes, variants, barcodes, and foreign image hosts", () => {
  expect(matchFoodFactsImage({ ...query, brand: "Great Value" }, source)).toBe(0);
  expect(matchFoodFactsImage({ ...query, size: "18.8 oz" }, source)).toBe(0);
  expect(matchFoodFactsImage({ ...query, productName: "Original Cheerios" }, source)).toBe(0);
  expect(matchFoodFactsImage({ ...query, upc: "0016000169685" }, source)).toBe(0);
  expect(safeFoodFactsImage("https://example.com/milk.jpg")).toBeNull();
  expect(matchFoodFactsImage(query, { ...source, image_front_url: "https://example.com/milk.jpg" })).toBe(0);
});

it("uses the clearly labeled generic illustration for broad or unavailable matches", () => {
  expect(matchFoodFactsImage({ productName: "Milk" }, { ...source, product_name: "Milk" })).toBe(0);
  expect(genericImage().imageType).toBe("generic_illustration");
  expect(genericImage().imageUrl).toBeNull();
});
