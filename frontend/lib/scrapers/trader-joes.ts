import { traderJoesReport } from "../trader-joes";
import type { RetailerScraper } from "./types";

export const traderJoesScraper: RetailerScraper = {
  id: "trader-joes",
  scrape: ({ items, plan, signal }) => traderJoesReport(items, plan, signal),
};
