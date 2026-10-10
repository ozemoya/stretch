import { centers } from "./locations";
export function areaFromIp(latitude: unknown, longitude: unknown) {
  if (
    typeof latitude !== "number" ||
    typeof longitude !== "number" ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  )
    return null;
  const rad = (n: number) => (n * Math.PI) / 180;
  const nearest = (Object.keys(centers) as (keyof typeof centers)[])
    .map((area) => {
      const c = centers[area];
      const a =
        Math.sin(rad(c.lat - latitude) / 2) ** 2 +
        Math.cos(rad(latitude)) *
          Math.cos(rad(c.lat)) *
          Math.sin(rad(c.lon - longitude) / 2) ** 2;
      return {
        area,
        miles: 3958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)),
      };
    })
    .sort((a, b) => a.miles - b.miles)[0];
  return nearest.miles <= 30 ? nearest.area : null;
}
