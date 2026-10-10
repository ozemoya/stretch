// Public retailer product pages verified October 9, 2026. These are online
// catalog candidates, not evidence of a nearby branch's price or availability.
export const verifiedProductSources: Record<
  string,
  Record<string, string[]>
> = {
  Publix: {
    bread: [
      "https://www.instacart.com/store/publix/products/103945-nature-s-own-butterbread-bread-20-oz",
    ],
    rice: [
      "https://www.instacart.com/store/publix/products/54639-lundberg-family-farms-sushi-rice-short-grain-california-2-lb",
    ],
    eggs: [
      "https://www.instacart.com/store/publix/products/324877-publix-eggs-large-12-ct",
    ],
    milk: [
      "https://www.instacart.com/store/publix/products/324942-publix-milk-whole-1-ea",
    ],
    "whole milk": [
      "https://www.instacart.com/store/publix/products/324942-publix-milk-whole-1-ea",
    ],
  },
  ALDI: {
    eggs: [
      "https://www.instacart.com/store/aldi/products/115095-goldhen-grade-a-large-eggs-12-ct",
    ],
    milk: [
      "https://www.instacart.com/store/aldi/products/16902710-friendly-farms-vitamin-d-milk-1-gal",
    ],
    "whole milk": [
      "https://www.instacart.com/store/aldi/products/16902710-friendly-farms-vitamin-d-milk-1-gal",
    ],
  },
  "The Fresh Market": {
    milk: [
      "https://www.instacart.com/store/the-fresh-market/products/19476600-the-fresh-market-rbst-free-whole-milk-64-fl-oz",
    ],
    eggs: [
      "https://www.instacart.com/store/the-fresh-market/products/19475989-the-fresh-market-white-cage-free-eggs-12-ct",
    ],
  },
  "Food Lion": {
    milk: [
      "https://www.instacart.com/store/food-lion/products/3139299-food-lion-milk-whole-jug-1-gal",
    ],
  },
  Sprouts: {
    eggs: [
      "https://shop.sprouts.com/store/sprouts/products/18164275-sprouts-cage-free-large-grade-aa-white-eggs-12-ct",
    ],
    milk: [
      "https://shop.sprouts.com/store/sprouts/products/17983905-sprouts-whole-milk-128-fl-oz",
    ],
    "whole milk": [
      "https://shop.sprouts.com/store/sprouts/products/17983905-sprouts-whole-milk-128-fl-oz",
    ],
  },
};
