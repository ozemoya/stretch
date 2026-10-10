import { describe, expect, it, vi } from "vitest";
import { cleanSearchPlan, planBasketSearch, reviewProductMatches } from "../lib/local-search-agent";

const items = [{ id: "eggs", name: "large eggs", unit: "dozen", quantity: 1 }];

describe("local search agent", () => {
  it("keeps food-specific queries and rejects prompt-injected URLs and unrelated searches", () => {
    const plan = cleanSearchPlan({ searches: [{ id: "eggs", queries: [
      "large eggs dozen site:fake.example",
      "https://evil.example/pay eggs",
    ] }] }, items);
    expect(plan?.queries.eggs).toEqual(["large eggs dozen"]);
    expect(cleanSearchPlan({ searches: [{ id: "eggs", queries: ["cheap tomatoes"] }] }, items)).toBeNull();
  });

  it("uses a real local model response to plan a basket search", async () => {
    const previous = globalThis.fetch;
    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/api/tags")) return Response.json({ models: [{ name: "llama3.2:3b" }] });
      return Response.json({ message: { content: JSON.stringify({ searches: [{ id: "eggs", queries: ["pasture raised eggs dozen"] }] }) } });
    }) as typeof fetch;
    try {
      const plan = await planBasketSearch(items);
      expect(plan?.queries.eggs).toEqual(["pasture raised eggs dozen"]);
      expect(calls).toEqual(["http://127.0.0.1:11434/api/tags", "http://127.0.0.1:11434/api/chat"]);
    } finally { globalThis.fetch = previous; }
  });

  it("rejects an unrelated product while preserving source price evidence", async () => {
    const previous = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => Response.json({message:{content:JSON.stringify({decisions:[
      {key:"0:0:0",kind:"unrelated"},{key:"0:0:1",kind:"match"},
      {key:"999:999:999",kind:"match"},
    ]})}})) as typeof fetch;
    const report = {retailer:"Trader Joe’s",status:"retrieved" as const,detail:"Official website",lines:[{
      item:items[0],products:[
        {id:"chocolate",name:"Chocolate Eggs",brand:"Trader Joe’s",size:"2 oz",priceCents:199,sourceUrl:"https://www.traderjoes.com/home/products/pdp/chocolate-eggs",retrievedAt:"2026-10-10"},
        {id:"fresh",name:"Large Eggs",brand:"Trader Joe’s",size:"1 dozen",priceCents:599,sourceUrl:"https://www.traderjoes.com/home/products/pdp/large-eggs",retrievedAt:"2026-10-10"},
      ],
    }]};
    try {
      const result = await reviewProductMatches([report]);
      expect(result.reviewed).toBe(2);
      expect(result.reports[0].lines[0].products.map(p=>p.id)).toEqual(["fresh"]);
      expect(result.reports[0].lines[0].products[0].priceCents).toBe(599);
    } finally {globalThis.fetch=previous;}
  });
});
