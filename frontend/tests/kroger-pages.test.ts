import { expect, it } from "vitest";
import { collectKrogerPages } from "../lib/live-data";

it("follows provider offsets until a short page and respects the page cap", async () => {
  const offsets: number[] = [];
  const result = await collectKrogerPages(
    async (start, limit) => {
      offsets.push(start);
      return Array.from(
        { length: start === 0 ? limit : 2 },
        (_, i) => start + i,
      );
    },
    20,
    3,
  );
  expect(offsets).toEqual([0, 20]);
  expect(result).toHaveLength(22);

  const capped: number[] = [];
  await collectKrogerPages(
    async (start, limit) => {
      capped.push(start);
      return Array.from({ length: limit }, (_, i) => start + i);
    },
    20,
    3,
  );
  expect(capped).toEqual([0, 20, 40]);
});
