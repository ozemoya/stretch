import {compareBasket} from "@/lib/compare-basket";
import type { PriceBatch } from "@/lib/scrapers/persistence";
import { savePricesAfterResponse } from "@/lib/scrapers/save-after-response";

export async function POST(request: Request) {
  const batches: PriceBatch[] = [];
  savePricesAfterResponse(() => batches);
  return compareBasket(request, undefined, undefined, {
    onPrices: prices => batches.push(...prices),
  });
}
