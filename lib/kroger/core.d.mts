import type {
  KrogerAmount,
  KrogerDependencies,
  KrogerProductRow,
  KrogerSearchOptions,
  KrogerSearchResult,
  KrogerStoreRow,
  KrogerUnit,
  KrogerWinner,
} from "./types";

export function normalizeSearchOptions(
  options: KrogerSearchOptions & { dryRun?: boolean },
): Omit<KrogerSearchOptions, "amount"> & {
  amount?: KrogerAmount;
  dryRun: boolean;
};
export function findCheapestKrogerProducts(
  options: KrogerSearchOptions,
  dependencies?: KrogerDependencies,
): Promise<KrogerSearchResult>;
export function saveCheapestKrogerProducts(
  options: KrogerSearchOptions,
  dependencies?: KrogerDependencies,
): Promise<KrogerSearchResult>;
export function run(
  options: KrogerSearchOptions & { dryRun?: boolean },
  dependencies?: KrogerDependencies,
): Promise<KrogerSearchResult>;
export function parsePackageSize(
  size: string,
  unit?: KrogerUnit,
): KrogerAmount | null;
export function parsePackageCount(
  size: string,
  unit?: KrogerUnit,
): number | null;
export function productRow(result: KrogerWinner): KrogerProductRow;
export function productDate(value: Date | string): string;
export function productID(
  searchTerm: string,
  locationId: string,
  requestedAmount?: KrogerAmount,
): number;
export function storeRow(result: KrogerWinner): KrogerStoreRow;
