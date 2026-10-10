import {input, compareBasket as compare} from "../../../../lib/compare-basket";
import {providerReports} from "../../../../lib/provider-prices";
import {traderJoesObserved} from "../../../../lib/trader-joes";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const body = await request.json().catch(()=>null);
  const parsed = input.safeParse(body);
  if (!parsed.success || new Set(parsed.data.items.map(i=>i.id)).size !== parsed.data.items.length)
    return Response.json({error:"Choose 1–30 distinct foods and a valid search location."},{status:400});
  const p = parsed.data;
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    async start(controller) {
      let open = true;
      request.signal.addEventListener("abort",()=>{open=false;},{once:true});
      const send = (value:unknown) => {if(open) controller.enqueue(encoder.encode(JSON.stringify(value)+"\n"));};
      try {
        send({type:"started"});
        // No collector is triggered by this cache read. Cached observations retain their timestamps.
        const tjLines=p.items.map(item=>({item,products:traderJoesObserved(item)}));
        if(tjLines.some(line=>line.products.length)) send({type:"report",cached:true,report:{retailer:"Trader Joe’s",status:"retrieved",detail:"Dated official website observations. Nearby branch presence is being checked.",lines:tjLines}});
        const cached = await providerReports(["Walmart","Target","Publix","ALDI","Sprouts","Costco","Albertsons family","Whole Foods"],p.items,p.zip,false,true);
        for (const report of cached) if(report.lines.some(line=>line.products.length)) send({type:"report",report,cached:true});
        const response = await compare(new Request(request.url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(p)}),report=>send({type:"report",report}));
        const result = await response.json();
        send(response.ok ? {type:"complete",result} : {type:"error",error:result.error});
      } catch {send({type:"error",error:"Website search interrupted. Retry to resume saved collection jobs."});}
      finally {if(open){open=false;controller.close();}}
    },
    cancel() { /* The bounded collectors may finish saving their existing jobs. */ },
  }),{headers:{"Content-Type":"application/x-ndjson","Cache-Control":"no-store","X-Accel-Buffering":"no"}});
}
