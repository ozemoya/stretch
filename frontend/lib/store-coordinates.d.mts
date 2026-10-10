export type StoreCoordinateInput = { latitude?: unknown; longitude?: unknown; address?: unknown };
export type StoreCoordinates = { latitude: number; longitude: number; source: "explicit" | "census-address" };
export function validStoreCoordinates(latitude: unknown, longitude: unknown): boolean;
export function storeAddress(address: unknown): string;
export function resolveStoreCoordinates(location: StoreCoordinateInput,
  options?: { fetcher?: typeof fetch; signal?: AbortSignal }): Promise<StoreCoordinates | null>;
