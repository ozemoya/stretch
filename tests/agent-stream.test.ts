import {it,expect,vi} from "vitest";
const report = {retailer:"Target",status:"retrieved",detail:"Catalog price",lines:[{item:{id:"milk",name:"milk",unit:"gallon",quantity:1},products:[{id:"p",name:"Milk",size:"1 gallon",priceCents:329,sourceUrl:"https://www.target.com/p/milk",retrievedAt:"2026-10-09T12:00:00Z"}]}]};
vi.mock("../lib/provider-prices",()=>({providerReports:vi.fn(async()=>[report])}));
vi.mock("../lib/compare-basket",async()=>{
 const {z}=await import("zod");
 return {input:z.object({items:z.array(z.object({id:z.string()})),zip:z.string()}),compareBasket:vi.fn(async(_request:Request,onReport:Function)=>{onReport(report);return Response.json({publicCatalogs:[report],stores:[]});})};
});
import {POST} from "../app/api/agent/search/route";
it("streams cached observations and collector updates before the completed result",async()=>{
 const response=await POST(new Request("http://localhost/api/agent/search",{method:"POST",body:JSON.stringify({zip:"30303",items:[{id:"milk"}]})}));
 expect(response.headers.get("content-type")).toBe("application/x-ndjson");
 const events=(await response.text()).trim().split("\n").map(line=>JSON.parse(line));
 expect(events.map(e=>e.type)).toEqual(["started","report","report","complete"]);
 expect(events[1].cached).toBe(true);
 expect(events[1].report.lines[0].products[0].retrievedAt).toBe("2026-10-09T12:00:00Z");
});
it("rejects duplicate items before starting any collection",async()=>{
 const response=await POST(new Request("http://localhost/api/agent/search",{method:"POST",body:JSON.stringify({zip:"30303",items:[{id:"milk"},{id:"milk"}]})}));
 expect(response.status).toBe(400);
});
