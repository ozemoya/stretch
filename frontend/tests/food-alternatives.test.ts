import { it, expect } from "vitest";
import { isCloseFood, selectFoodMatches } from "../lib/food-alternatives";
it("finds another brand while keeping dietary constraints", () => {
  expect(
    isCloseFood(
      "Trader Joes organic whole milk",
      "Organic Whole Milk 1 gallon",
    ),
  ).toBe(true);
  expect(isCloseFood("organic whole milk", "Whole Milk 1 gallon")).toBe(false);
  expect(isCloseFood("milk", "Chocolate Milk Powder")).toBe(false);
  expect(isCloseFood("eggs", "Eggo Pancakes")).toBe(false);
});
it("labels close food matches without assigning them to another store", () => {
  const p = {
    id: "p",
    name: "Organic Whole Milk",
    size: "1 gallon",
    brand: "Other",
    priceCents: 399,
    sourceUrl: "https://example.com",
    retrievedAt: "2026-10-10",
  };
  expect(
    selectFoodMatches([p], "Trader Joes organic milk", () => false)[0]
      .matchKind,
  ).toBe("alternative");
});
