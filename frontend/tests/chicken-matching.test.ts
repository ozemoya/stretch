import { expect, it } from "vitest";
import { isCloseFood } from "../lib/food-alternatives";

it("accepts raw chicken counterparts without treating prepared meals as raw chicken", () => {
  expect(isCloseFood("Chicken", "All Natural Chicken Drumsticks")).toBe(true);
  expect(isCloseFood("Chicken", "hearty chicken soup")).toBe(false);
  expect(isCloseFood("Chicken", "Chicken Nuggets")).toBe(false);
  expect(isCloseFood("Chicken Nuggets", "Chicken Breast")).toBe(false);
  expect(isCloseFood("Chicken Nuggets", "Organic Chicken Nuggets")).toBe(true);
  expect(isCloseFood("Chicken Breast", "All Natural Chicken Drumsticks")).toBe(false);
  expect(isCloseFood("Chicken Breast", "Cubed Chicken Breast")).toBe(true);
});
