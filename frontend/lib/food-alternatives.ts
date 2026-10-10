import type { ScrapedProduct } from "./retailer-scraper";
const tokens = (text: string): string[] =>
  text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
const groups = [
  ["milk", "milks"],
  ["egg", "eggs"],
  ["bread", "loaf", "loaves"],
  ["rice"],
  ["banana", "bananas"],
  ["apple", "apples"],
  ["pasta", "spaghetti", "penne", "macaroni"],
  ["yogurt", "yoghurt"],
  ["potato", "potatoes"],
  ["lentil", "lentils"],
  ["chicken", "chickens"],
];
export function isCloseFood(request: string, name: string) {
  const wanted = tokens(request),
    actual = tokens(name);
  const group = groups.find((g) => g.some((w) => wanted.includes(w)));
  if (!group || !group.some((w) => actual.includes(w))) return false;
  // Preserve explicit dietary requirements; labels still require review.
  for (const requirement of [
    "organic",
    "vegan",
    "gluten free",
    "lactose free",
    "dairy free",
    "unsweetened",
  ]) {
    if (
      request.toLowerCase().includes(requirement) &&
      !name.toLowerCase().includes(requirement)
    )
      return false;
  }
  if (
    group.includes("milk") &&
    /chocolate|powder|condensed|evaporated|creamer/.test(name.toLowerCase()) &&
    !/chocolate|powder|condensed|evaporated|creamer/.test(request.toLowerCase())
  )
    return false;
  if (group.includes("chicken")) {
    const requested = request.toLowerCase();
    const candidate = name.toLowerCase();
    const preparedKinds = ["nugget", "sausage", "meatball", "soup", "broth", "stock", "wrap", "sandwich", "salad", "pizza", "pasta", "rice", "jerky", "chip"];
    const requestedKind = preparedKinds.find((kind) => requested.includes(kind));
    const candidateKind = preparedKinds.find((kind) => candidate.includes(kind));
    if (requestedKind !== candidateKind) return false;
    for (const cut of ["breast", "thigh", "wing", "drumstick", "ground"]) {
      if (requested.includes(cut) && !candidate.includes(cut)) return false;
    }
  }
  return true;
}
export function selectFoodMatches(
  products: ScrapedProduct[],
  request: string,
  exact: (name: string, term: string) => boolean,
): ScrapedProduct[] {
  const matches = products.filter((p) => exact(p.name, request));
  return matches.length
    ? matches
    : products
        .filter((p) => isCloseFood(request, p.name))
        .map((p) => ({ ...p, matchKind: "alternative" as const }));
}
