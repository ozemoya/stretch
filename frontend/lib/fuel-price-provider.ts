import { localFuel, localFuelConfigured, type Area, type FuelType, type LocalFuelResult } from "./live-data";
import type { SearchOrigin } from "./locations";

export type FuelPriceVerification = "reported" | "unavailable";
export type FuelPriceRecord = {
  stationId: string;
  grade: FuelType;
  dollarsPerGallon: number | null;
  updatedAt: string | null;
  source: string;
  verification: FuelPriceVerification;
};

export interface FuelPriceProvider {
  readonly id: string;
  readonly label: string;
  isConfigured(): boolean;
  search(area: Area, radiusMiles: number, grade: FuelType, origin?: SearchOrigin): Promise<LocalFuelResult>;
}

// Google reports the last known pump price where supplied. This is not a live
// pump verification, and a missing or old report must stay unavailable.
export const googleReportedFuelProvider: FuelPriceProvider = {
  id: "google-reported",
  label: "Google Maps reported fuel prices",
  isConfigured: localFuelConfigured,
  search: localFuel,
};

export function configuredFuelPriceProvider(): FuelPriceProvider | null {
  return googleReportedFuelProvider.isConfigured() ? googleReportedFuelProvider : null;
}

export function fuelPriceRecord(station: LocalFuelResult["stations"][number], grade: FuelType): FuelPriceRecord {
  const usable = !station.stale && station.dollarsPerGallon !== null && !!station.updatedAt;
  return {
    stationId: station.id,
    grade,
    dollarsPerGallon: usable ? station.dollarsPerGallon : null,
    updatedAt: station.updatedAt,
    source: "Google Maps reported fuel price",
    verification: usable ? "reported" : "unavailable",
  };
}

// A Place ID is the station identity. Never match prices by a chain name.
export function stationPriceForPlace(result: LocalFuelResult, placeId: string, lat: number, lon: number) {
  const station = result.stations.find((candidate) => candidate.id === placeId);
  if (!station || Math.abs(station.lat - lat) > 0.001 || Math.abs(station.lon - lon) > 0.001) return null;
  return fuelPriceRecord(station, result.fuelType as FuelType);
}
