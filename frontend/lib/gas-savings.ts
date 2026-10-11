import { bestRoadRoute, type RoadMatrix } from "./mix-match-optimizer";

export type GasSavingsInput = {
  gallonsNeeded: number;
  mpg: number;
  baselinePrice: number;
  alternativePrice: number;
  drivingFuelPrice: number;
  baselineRouteMiles: number;
  alternativeRouteMiles: number;
  noGasRouteMiles: number;
  maxDetourMiles: number;
};

export function calculateGasSavings(input: GasSavingsInput) {
  const values = Object.values(input);
  if (values.some((value) => !Number.isFinite(value) || value < 0) ||
    input.gallonsNeeded <= 0 || input.mpg <= 0 || input.baselinePrice <= 0 ||
    input.alternativePrice <= 0 || input.drivingFuelPrice <= 0) return null;
  const baselinePurchaseCents = Math.round(input.gallonsNeeded * input.baselinePrice * 100);
  const alternativePurchaseCents = Math.round(input.gallonsNeeded * input.alternativePrice * 100);
  const additionalRouteMiles = input.alternativeRouteMiles - input.baselineRouteMiles;
  const additionalDrivingFuelCents = Math.round(additionalRouteMiles / input.mpg * input.drivingFuelPrice * 100);
  const detourMiles = Math.max(0, input.alternativeRouteMiles - input.noGasRouteMiles);
  return { baselinePurchaseCents, alternativePurchaseCents, additionalRouteMiles,
    additionalDrivingFuelCents, detourMiles, withinDistanceLimit: detourMiles <= input.maxDetourMiles,
    netSavingsCents: baselinePurchaseCents - alternativePurchaseCents - additionalDrivingFuelCents };
}

export function milesFromRoadMatrix(distances: (number | null)[][], storeIds: string[], stationIndex: number | null) {
  const indexes = [0, ...storeIds.map((_, index) => index + 1), ...(stationIndex === null ? [] : [stationIndex])];
  if (indexes.some((index) => !distances[index])) return null;
  if (!storeIds.length) {
    if (stationIndex === null) return 0;
    const outbound = distances[0]?.[stationIndex], inbound = distances[stationIndex]?.[0];
    return outbound === null || inbound === null || outbound === undefined || inbound === undefined ? null : (outbound + inbound) / 1609.344;
  }
  const reduced = indexes.map((from) => indexes.map((to) => distances[from]?.[to] ?? null));
  const matrix: RoadMatrix = { storeIds, distances: reduced, durations: reduced, hasFuelStop: stationIndex !== null };
  return bestRoadRoute(storeIds, matrix)?.miles ?? null;
}
