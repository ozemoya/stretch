// Trusted retailer identities. Add a domain here to use the default scraper without a custom adapter.
export const sourceHosts: Record<string, string[]> = {
  "Kroger family": ["www.kroger.com"],
  "Whole Foods": ["www.wholefoodsmarket.com"],
  Lidl: ["www.lidl.com"],
  "Trader Joe’s": ["www.traderjoes.com"],
  "The Fresh Market": [
    "shop.thefreshmarket.com",
    "www.thefreshmarket.com",
    "www.instacart.com",
  ],
  ALDI: ["www.instacart.com"],
  Publix: ["www.publix.com", "www.instacart.com"],
  "Food Lion": ["www.instacart.com"],
  "Sam’s Club": ["www.instacart.com"],
  Walmart: ["www.walmart.com"],
  Target: ["www.target.com"],
  Sprouts: ["shop.sprouts.com"],
  Costco: ["www.costco.com"],
  "Albertsons family": ["www.safeway.com"],
};
export const instacartSlugs: Record<string, string> = {
  ALDI: "aldi",
  Publix: "publix",
  "The Fresh Market": "the-fresh-market",
  "Food Lion": "food-lion",
  "Sam’s Club": "sams-club",
};
export function knownRetailerForUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.hostname === "www.instacart.com") {
      const slug = url.pathname.match(/^\/store\/([^/]+)\/products\//)?.[1];
      return (
        Object.entries(instacartSlugs).find(
          ([, known]) => known === slug,
        )?.[0] ?? null
      );
    }
    return (
      Object.entries(sourceHosts).find(
        ([, hosts]) =>
          hosts.includes(url.hostname) && url.hostname !== "www.instacart.com",
      )?.[0] ?? null
    );
  } catch {
    return null;
  }
}
export function catalogSourceBelongsToRetailer(
  retailerId: string,
  value: string,
) {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      (url.port !== "" && url.port !== "443") ||
      !sourceHosts[retailerId]?.includes(url.hostname)
    )
      return false;
    if (url.hostname === "www.instacart.com")
      return url.pathname.startsWith(
        `/store/${instacartSlugs[retailerId]}/products/`,
      );
    return true;
  } catch {
    return false;
  }
}
