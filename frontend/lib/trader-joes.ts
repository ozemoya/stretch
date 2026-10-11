import {load} from "cheerio";
import observed from "./trader-joes-observations.json";
import {validDiscoveredSource} from "./ai-source-search";
import type {AgentItem} from "./price-agent";
import type {ScrapedProduct,ScrapeReport} from "./retailer-scraper";
import {isCloseFood} from "./food-alternatives";
import type {SearchPlan} from "./local-search-agent";
import {packageMatches} from "./package-match";
const retailer="Trader Joe’s";
const catalogQuery = `query SearchProducts($search: String, $pageSize: Int, $currentPage: Int, $storeCode: String = "TJ") {
  products(search: $search, filter: {store_code: {eq: $storeCode}}, pageSize: $pageSize, currentPage: $currentPage) {
    page_info { total_pages }
    items { sku item_title retail_price sales_size sales_uom_description availability published primary_image }
  }
}`;
type CatalogItem = {sku?:unknown;item_title?:unknown;retail_price?:unknown;sales_size?:unknown;sales_uom_description?:unknown;availability?:unknown;published?:unknown;primary_image?:unknown};
export function parseTraderJoesCatalog(items:CatalogItem[],item:AgentItem,at=new Date().toISOString()):ScrapedProduct[] {
 return items.flatMap(row=>{
   if(typeof row.sku!=="string"||!/^\d{6}$/.test(row.sku)||typeof row.item_title!=="string"||
     !isCloseFood(item.name,row.item_title)||String(row.availability)!=="1"||String(row.published)!=="1")return [];
   const price=Number(row.retail_price),sizeNumber=Number(row.sales_size),unit=typeof row.sales_uom_description==="string"?row.sales_uom_description.trim():"";
   if(!Number.isFinite(price)||price<=0||price>1000||!Number.isFinite(sizeNumber)||sizeNumber<=0||!unit)return [];
   const sourceUrl=`https://www.traderjoes.com/home/products/pdp/${row.sku}`;
   const imageUrl=typeof row.primary_image==="string"&&row.primary_image.startsWith("/content/dam/trjo/products/")
     ?new URL(row.primary_image,"https://www.traderjoes.com").href:undefined;
   const name=row.item_title.trim(),size=`${sizeNumber} ${unit}`;
   return [{id:row.sku,productId:row.sku,name,brand:"Trader Joe's",priceCents:Math.round(price*100),size,
     sourceUrl,imageUrl,retrievedAt:at,verification:"official-page-observation" as const,
     ...(!item.name.toLowerCase().split(/\s+/).every(word=>name.toLowerCase().includes(word))?{matchKind:"alternative" as const}:{})}];
 }).sort((a,b)=>Number(packageMatches(item.unit,b.size))-Number(packageMatches(item.unit,a.size))||a.priceCents-b.priceCents);
}
async function searchTraderJoesCatalog(item:AgentItem,signal?:AbortSignal):Promise<ScrapedProduct[]> {
 const products:ScrapedProduct[]=[];
 for(let page=1;page<=2;page++) {
   signal?.throwIfAborted();
   const response=await fetch("https://www.traderjoes.com/api/graphql",{
     method:"POST",redirect:"error",headers:{"Content-Type":"application/json"},
     signal:signal?AbortSignal.any([signal,AbortSignal.timeout(10000)]):AbortSignal.timeout(10000),
     body:JSON.stringify({query:catalogQuery,variables:{search:item.name,pageSize:40,currentPage:page}}),
   });
   if(!response.ok)throw new Error("Trader Joe’s catalog did not respond.");
   const body=await response.json();
   if(body.errors?.length||!Array.isArray(body.data?.products?.items))throw new Error("Trader Joe’s catalog response was incomplete.");
   products.push(...parseTraderJoesCatalog(body.data.products.items,item));
   if(products.length>=8||page>=Number(body.data.products.page_info?.total_pages??1))break;
 }
 return [...new Map(products.map(product=>[product.id,product])).values()].slice(0,12);
}
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
     try {
       const products=await searchTraderJoesCatalog(item,signal);
       return {item,products,...(!products.length?{searchStatus:"no_results" as const,error:"No matching priced item appeared in the first 80 official catalog results."}:{})};
     } catch(error) {
       if(signal?.aborted)throw error;
       return {item,products:[],searchStatus:"error" as const,error:error instanceof Error?error.message:"Trader Joe’s catalog search failed."};
     }
   })();
   pending.set(key,task);try{const line=await task;if(!signal?.aborted)recent.set(key,{at:Date.now(),line});return line;}finally{pending.delete(key);}
 }));
 return {retailer,status:lines.some(l=>l.products.length)?"retrieved":"failed",detail:"Prices returned by Trader Joe’s public online catalog; observation time is shown on each item. In-store stock and checkout prices may differ.",lines};
}
