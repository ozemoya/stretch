import { createScraperRegistry } from "./registry";
import { defaultScraper } from "./default";
import { lidlScraper } from "./lidl";
import { traderJoesScraper } from "./trader-joes";
import { freshMarketScraper } from "./fresh-market";
import { krogerScraper } from "./kroger";
import { publixScraper } from "./publix";

// Add a library adapter here; orchestration and database persistence remain shared.
export const scraperRegistry = createScraperRegistry(defaultScraper, [
  ["Lidl", lidlScraper],
  ["Trader Joe’s", traderJoesScraper],
  ["The Fresh Market", freshMarketScraper],
  ["Kroger family", krogerScraper],
  ["Publix", publixScraper],
]);
