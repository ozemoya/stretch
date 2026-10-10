import type { CheckoutDraft } from "./checkout-draft";
import type { TripReview } from "./trip-review";
import { validCoordinates } from "./locations";

// The same ordered stops used for the estimate: origin → grocery → gas → origin.
export function tripDirectionsUrl(draft: CheckoutDraft, review: TripReview): string | null {
  const origin = draft.origin;
  const gas = draft.gasStop;
  if (!origin || !gas || gas.id !== review.gasStopId ||
      !validCoordinates(origin.lat, origin.lon) ||
      !validCoordinates(review.storeLat, review.storeLon) ||
      !validCoordinates(gas.lat, gas.lon)) return null;
  const home = `${origin.lat},${origin.lon}`;
  const url = new URL("https://www.google.com/maps/dir/");
  url.searchParams.set("api", "1");
  url.searchParams.set("origin", home);
  url.searchParams.set("destination", home);
  url.searchParams.set("waypoints", `${review.storeLat},${review.storeLon}|${gas.lat},${gas.lon}`);
  url.searchParams.set("travelmode", "driving");
  return url.toString();
}
