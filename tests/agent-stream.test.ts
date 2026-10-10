import {it,expect,vi} from "vitest";
const report = {retailer:"Target",status:"retrieved",detail:"Catalog price",lines:[{item:{id:"milk",name:"milk",unit:"gallon",quantity:1},products:[{id:"p",name:"Milk",size:"1 gallon",priceCents:329,sourceUrl:"https://www.target.com/p/milk",retrievedAt:"2026-10-09T12:00:00Z"}]}]};
vi.mock("../lib/trader-joes",()=>({traderJoesObserved:()=>[]}));
vi.mock("../lib/local-search-agent",()=>({planBasketSearch:vi.fn(async()=>({provider:"local-ai",model:"test",queries:{milk:["whole milk gallon"]}}))}));
vi.mock("../lib/live-data",()=>({nearbyPlaces:vi.fn(async()=>({places:[]}))}));
vi.mock("../lib/retailer-scraper",()=>({scrapeRetailers:vi.fn(async(_stores:unknown,_items:unknown,_places:unknown,_plan:unknown,_signal:unknown,onReport?:Function)=>{await new Promise(resolve=>setTimeout(resolve,20));onReport?.(report);return [report]})}));
vi.mock("../lib/provider-prices",()=>({providerReports:vi.fn(async(_retailers:unknown,_items:unknown,_zip:unknown,_start:unknown,_cacheOnly:unknown,onReport?:Function)=>{if(onReport){await Promise.resolve();onReport(report)}return [report]})}));
vi.mock("../lib/compare-basket",async()=>{
 const {z}=await import("zod");
 return {input:z.object({items:z.array(z.object({id:z.string()})),zip:z.string(),area:z.string().default("downtown"),radius:z.number().default(5)}),compareBasket:vi.fn(async(_request:Request,_onReport:Function,_plan:unknown,options:unknown)=>{expect(options).toEqual({deferProvider:true,deferPublic:true,deferPlan:true});return Response.json({publicCatalogs:[],stores:[],storeCoverage:[{retailer:"Target"}]});})};
});
import {POST} from "../app/api/agent/search/route";
import {planBasketSearch} from "../lib/local-search-agent";
it("returns the initial comparison before public and provider catalog searches finish",async()=>{
 const response=await POST(new Request("http://localhost/api/agent/search",{method:"POST",body:JSON.stringify({zip:"30303",items:[{id:"milk"}]})}));
 expect(response.headers.get("content-type")).toBe("application/x-ndjson");
 const events=(await response.text()).trim().split("\n").map(line=>JSON.parse(line));
 expect(events.map(e=>e.type).slice(0,4)).toEqual(["started","report","agent","complete"]);
 expect(events.some(e=>e.type==="sources-complete")).toBe(true);
 expect(events.findIndex(e=>e.type==="complete")).toBeLessThan(events.findIndex(e=>e.type==="sources-complete"));
 expect(events.slice(events.findIndex(e=>e.type==="complete")+1).some(e=>e.type==="report"&&e.cached!==true)).toBe(true);
 expect(events.findIndex(e=>e.type==="complete")).toBeLessThan(events.findIndex(e=>e.type==="agent"&&e.stage==="ready"));
 expect(events[1].cached).toBe(true);
 expect(events[1].report.lines[0].products[0].retrievedAt).toBe("2026-10-09T12:00:00Z");
 expect(events.filter(e=>e.type==="report"&&e.cached!==true).length).toBe(2);
});
it("rejects duplicate items before starting any collection",async()=>{
 const response=await POST(new Request("http://localhost/api/agent/search",{method:"POST",body:JSON.stringify({zip:"30303",items:[{id:"milk"},{id:"milk"}]})}));
 expect(response.status).toBe(400);
});
it("continues retailer collection when AI planning exceeds its deadline",async()=>{
 vi.mocked(planBasketSearch).mockImplementationOnce(async (_items, signal)=>{
   await new Promise<void>(resolve=>signal?.addEventListener("abort",()=>resolve(),{once:true}));
   return null;
 });
 const controller = new AbortController();
 const started=Date.now();
 const response=await POST(new Request("http://localhost/api/agent/search",{method:"POST",body:JSON.stringify({zip:"30303",items:[{id:"milk"}]}),signal:controller.signal}));
 const reader=response.body!.getReader();
 const decoder=new TextDecoder();
 let events: {type:string}[]=[];
 let pending="";
 while(!events.some(event=>event.type==="complete")) {
   const chunk=await reader.read();
   expect(chunk.done).toBe(false);
   pending+=decoder.decode(chunk.value);
   const lines=pending.split("\n");
   pending=lines.pop()??"";
   events.push(...lines.filter(Boolean).map(line=>JSON.parse(line)));
 }
 expect(events.some(event=>event.type==="report")).toBe(true);
 expect(Date.now()-started).toBeLessThan(1000);
 controller.abort();
 await reader.cancel();
});
