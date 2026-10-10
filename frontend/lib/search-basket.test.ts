import { describe, expect, it } from "vitest";
import catalog from "./sample-catalog.json";
import { addSearchItems } from "./search-basket";

describe("groceries from landing page searches", () => {
  it("adds multiple searched groceries while preserving the current list and quantities", () => {
    const basket = [{ productId: "milk", quantity: 3 }, { productId: "rice", quantity: 2 }];
    const result = addSearchItems(" MILK, eggs and bread ", catalog.products, basket);
    expect(result.basket).toEqual([...basket,
      { productId: "eggs", quantity: 1 }, { productId: "bread", quantity: 1 }]);
    expect(result.unmatched).toEqual([]);
    expect(basket).toHaveLength(2);
  });

  it("prefers an exact product name over a partial match and deduplicates repeated terms", () => {
    const products = [
      { ...catalog.products[1], id: "oat-milk", name: "Oat milk" },
      catalog.products[1],
    ];
    const result = addSearchItems("milk; Milk & oat", products, []);
    expect(result.basket).toEqual([
      { productId: "milk", quantity: 1 }, { productId: "oat-milk", quantity: 1 }]);
  });

  it("reports unavailable groceries without losing matched items", () => {
    const result = addSearchItems("eggs\ndragon fruit", catalog.products, []);
    expect(result.basket).toEqual([{ productId: "eggs", quantity: 1 }]);
    expect(result.unmatched).toEqual(["dragon fruit"]);
  });

  it("ignores empty searches and does not duplicate items when a search is reapplied", () => {
    const basket = addSearchItems("milk", catalog.products, []).basket;
    expect(addSearchItems("milk", catalog.products, basket).basket).toEqual(basket);
    expect(addSearchItems("  , ; ", catalog.products, basket).basket).toEqual(basket);
  });
});
