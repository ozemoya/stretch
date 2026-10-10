import { expect, it } from "vitest";
import { fuelCostCents } from "../lib/live-trip";

it("calculates fuel from the measured route and configured vehicle and pump price", () => {
  expect(fuelCostCents(20, 25, 3.5)).toBe(280);
  expect(fuelCostCents(20, 0, 3.5)).toBeNull();
  expect(fuelCostCents(-1, 25, 3.5)).toBeNull();
  expect(fuelCostCents(20, 25, 0)).toBeNull();
});
