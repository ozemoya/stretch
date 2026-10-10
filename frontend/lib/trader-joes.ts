import {load} from "cheerio";
import observed from "./trader-joes-observations.json";
import {discoverSources,validDiscoveredSource} from "./ai-source-search";
import type {AgentItem} from "./price-agent";
import type {ScrapedProduct,ScrapeReport} from "./retailer-scraper";
import {isCloseFood} from "./food-alternatives";
import type {SearchPlan} from "./local-search-agent";
const retailer="Trader Joe’s";
export function parseTraderJoesPage(html:string,url:string,at=new Date().toISOString()):ScrapedProduct[] {
 if(!validDiscoveredSource(retailer,url))return [];
 const $=load(html),heading=$("h1").first(),scope=heading.parent();
 const name=heading.text().trim(),price=scope.find('[class*="productPrice__price"]').first().text().trim(),size=scope.find('[class*="productPrice__unit"]').first().text().trim().replace(/^\//,"");
 if(!name || !/^\$\d+\.\d{2}$/.test(price) || !size)return [];
 const cents=Math.round(Number(price.slice(1))*100);if(cents<=0||cents>100000)return [];
 const src=scope.find('img[src*="/products/"]').first().attr('src');
 return [{id:url.split('-').pop()!,name,brand:"Trader Joe's",priceCents:cents,size,sourceUrl:url,imageUrl:src?new URL(src,url).href:undefined,retrievedAt:at,verification:"official-page-observation"}];
}
export function traderJoesObserved(item:AgentItem,now=Date.now()):ScrapedProduct[] {
 return observed.filter(p=>now-Date.parse(p.retrievedAt)<86400000 && now>=Date.parse(p.retrievedAt) && isCloseFood(item.name,p.name)).map(p=>({...p,verification:"official-page-observation" as const,...(!item.name.toLowerCase().split(/\s+/).every(word=>p.name.toLowerCase().includes(word))?{matchKind:"alternative" as const}:{})}));
}
const pending=new Map<string,Promise<ScrapeReport['lines'][number]>>();
const recent=new Map<string,{at:number;line:ScrapeReport['lines'][number]}>();
export async function traderJoesReport(items:AgentItem[],plan?:SearchPlan,signal?:AbortSignal):Promise<ScrapeReport> {
 const lines=await Promise.all(items.map(async item=>{
   signal?.throwIfAborted();
   const products=traderJoesObserved(item);
   if(products.length)return {item,products};
   const key=item.name.toLowerCase();const cached=recent.get(key);
   if(cached&&Date.now()-cached.at<300000)return {...cached.line,item};
   const existing=pending.get(key);if(existing)return {...await existing,item};
   const task=(async()=>{
     let products:ScrapedProduct[]=[];
     try {
       const urls=await discoverSources(retailer,item,"",plan,{signal});
       signal?.throwIfAborted();
       const results=await Promise.allSettled(urls.map(async url=>{
         const response=await fetch(url,{redirect:"error",signal:signal?AbortSignal.any([signal,AbortSignal.timeout(12000)]):AbortSignal.timeout(12000)});
         if(!response.ok)return [];
         const html=await response.text();if(html.length>4000000)return [];
         return parseTraderJoesPage(html,url).filter(p=>isCloseFood(item.name,p.name));
       }));
       products=results.flatMap(r=>r.status==="fulfilled"?r.value:[]);
     } catch {}
     return {item,products,...(!products.length?{error:"Official product-page search completed, but price content could not be verified. A rendered-page refresh is needed."}:{})};
   })();
   pending.set(key,task);try{const line=await task;if(!signal?.aborted)recent.set(key,{at:Date.now(),line});return line;}finally{pending.delete(key);}
 }));
 return {retailer,status:lines.some(l=>l.products.length)?"retrieved":"failed",detail:"Prices observed on Trader Joe’s official website; observation time is shown on each item. Cached observations expire after 24 hours. Local branch availability and checkout prices still require confirmation.",lines};
}
