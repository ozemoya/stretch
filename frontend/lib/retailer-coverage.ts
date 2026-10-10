import type { NearbyPlace } from "./live-data";
export type StoreCoverage = {
  id: string;
  name: string;
  address: string;
  miles: number;
  lat: number;
  lon: number;
  mapUrl: string;
  retailer: string;
  status: "unavailable" | "checked" | "failed";
  detail: string;
};
export function retailerName(place: Pick<NearbyPlace, "name" | "brand">) {
  const name = `${place.brand ?? ""} ${place.name}`;
  const brands: [RegExp, string][] = [
    [
      /kroger|harris teeter|fred meyer|ralphs|king soopers|smith['’]?s/i,
      "Kroger family",
    ],
    [/publix/i, "Publix"],
    [/walmart/i, "Walmart"],
    [/target/i, "Target"],
    [/aldi/i, "ALDI"],
    [/lidl/i, "Lidl"],
    [/whole foods/i, "Whole Foods"],
    [/trader joe/i, "Trader Joe’s"],
    [/costco/i, "Costco"],
    [/sam['’]?s club/i, "Sam’s Club"],
    [/sprouts/i, "Sprouts"],
    [/food lion/i, "Food Lion"],
    [/safeway|albertsons/i, "Albertsons family"],
    [/fresh market/i, "The Fresh Market"],
  ];
  return (
    brands.find(([pattern]) => pattern.test(name))?.[1] ??
    "Independent / other retailer"
  );
}
export function groceryCoverage(places: NearbyPlace[]): StoreCoverage[] {
  return places
    .filter((p) => p.kind === "grocery")
    .map((p) => ({
      id: p.id,
      name: p.name,
      address: p.address,
      miles: p.miles,
      lat: p.lat,
      lon: p.lon,
      mapUrl: p.mapUrl,
      retailer: retailerName(p),
      status: "unavailable",
      detail:
        "No connected price source for this location. Prices have not been checked.",
    }));
}
