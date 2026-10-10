import { expect, it } from "vitest";
import { planBasketSearch, reviewProductMatches } from "../lib/local-search-agent";

it.skipIf(process.env.STRETCH_LIVE_AGENT_TEST !== "1")(
  "gets food-specific search phrases from the installed local model",
  async () => {
    const plan = await planBasketSearch([
      { id: "milk", name: "milk", unit: "gallon", quantity: 1 },
      { id: "eggs", name: "eggs", unit: "dozen", quantity: 1 },
    ]);
    expect(plan?.provider).toBe("local-ai");
    expect(plan?.queries.milk?.length).toBeGreaterThan(0);
    expect(plan?.queries.eggs?.length).toBeGreaterThan(0);
    const reviewed = await reviewProductMatches([{retailer:"Trader Joe’s",status:"retrieved",detail:"Official page",lines:[{item:{id:"eggs",name:"eggs",unit:"dozen",quantity:1},products:[
      {id:"candy",name:"Chocolate Truffle Eggs",brand:"Trader Joe’s",size:"2 oz",priceCents:299,sourceUrl:"https://www.traderjoes.com/home/products/pdp/chocolate-truffle-eggs",retrievedAt:"2026-10-10"},
      {id:"fresh",name:"Pasture Raised Large Brown Eggs",brand:"Trader Joe’s",size:"1 Doz",priceCents:599,sourceUrl:"https://www.traderjoes.com/home/products/pdp/pasture-raised-eggs",retrievedAt:"2026-10-10"},
    ]}]}]);
    expect(reviewed.reviewed).toBeGreaterThan(0);
    expect(reviewed.reports[0].lines[0].products.some(p=>p.id==="fresh")).toBe(true);
  }, 30000,
);
