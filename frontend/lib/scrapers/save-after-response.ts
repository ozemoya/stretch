import { after } from "next/server";
import { savePriceBatch, type PriceBatch } from "./persistence";

/** Next keeps this work alive after streaming finishes, including a search timeout. */
export function savePricesAfterResponse(batches: () => PriceBatch[]) {
  after(async () => {
    const pending = batches();
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(3, pending.length) }, async () => {
      while (next < pending.length) {
        const batch = pending[next++];
        const result = await savePriceBatch(batch);
        if (result.status === "failed" || result.status === "unconfigured")
          console.error("Price persistence:", result.error);
      }
    }));
  });
}
