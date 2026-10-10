import { describe, expect, it } from "vitest";
import { createSavedList, readSavedLists, readSavedSettings, writeSavedLists, writeSavedSettings } from "./saved-plans";

const prefs = { area: "midtown" as const, budget: 35, mpg: 27, gas: 3.5,
  maxStops: 2, vegan: false, glutenFree: true, nutFree: false };
const basket = [{ productId: "milk", quantity: 2 }];
function memoryStorage() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); } };
}

describe("saved guest lists", () => {
  it("persists a named list and preferences across sessions", () => {
    const storage = memoryStorage();
    const settings = { prefs, manualOrigin: { lat: 33.78, lon: -84.38, label: "Midtown" } };
    const list = createSavedList("one", "  Weekly groceries  ", basket, settings)!;
    expect(list.name).toBe("Weekly groceries");
    expect(writeSavedLists(storage, [list])).toBe(true);
    expect(readSavedLists(storage)).toEqual([list]);
    expect(writeSavedSettings(storage, settings)).toBe(true);
    expect(readSavedSettings(storage)).toEqual(settings);
  });

  it("does not store empty, duplicate, or over-limit lists", () => {
    const storage = memoryStorage();
    const settings = { prefs, manualOrigin: null };
    expect(createSavedList("empty", "Empty", [], settings)).toBeNull();
    expect(createSavedList("duplicate", "Duplicate", [...basket, ...basket], settings)).toBeNull();
    const list = createSavedList("one", "Weekly", basket, settings)!;
    expect(writeSavedLists(storage, [list, list])).toBe(false);
    expect(readSavedLists(storage)).toEqual([]);
  });
  it("saves the same per-item quantity range as the active planner", () => {
    const settings = { prefs, manualOrigin: null };
    expect(createSavedList("bulk", "Bulk", [{ productId: "milk", quantity: 99 }], settings)?.basket[0].quantity).toBe(99);
    expect(createSavedList("too-many", "Bulk", [{ productId: "milk", quantity: 100 }], settings)).toBeNull();
  });
});
