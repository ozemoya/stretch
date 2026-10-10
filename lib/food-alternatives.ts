import type {ScrapeReport,ScrapedProduct} from "./retailer-scraper";
const tokens=(text:string):string[]=>text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
const groups=[['milk','milks'],['egg','eggs'],['bread','loaf','loaves'],['rice'],['banana','bananas'],['apple','apples'],['pasta','spaghetti','penne','macaroni'],['yogurt','yoghurt'],['potato','potatoes'],['lentil','lentils']];
export function isCloseFood(request:string,name:string) {
 const wanted=tokens(request),actual=tokens(name);
 const group=groups.find(g=>g.some(w=>wanted.includes(w)));
 if(!group || !group.some(w=>actual.includes(w)))return false;
 // Preserve explicit dietary requirements; labels still require review.
 for(const requirement of ['organic','vegan','gluten free','lactose free','dairy free','unsweetened']) {
   if(request.toLowerCase().includes(requirement) && !name.toLowerCase().includes(requirement))return false;
 }
 if(group.includes('milk') && /chocolate|powder|condensed|evaporated|creamer/.test(name.toLowerCase()) && !/chocolate|powder|condensed|evaporated|creamer/.test(request.toLowerCase()))return false;
 return true;
}
export function selectFoodMatches(products:ScrapedProduct[],request:string,exact:(name:string,term:string)=>boolean):ScrapedProduct[] {
 const matches=products.filter(p=>exact(p.name,request));
 return matches.length?matches:products.filter(p=>isCloseFood(request,p.name)).map(p=>({...p,matchKind:'alternative' as const}));
}
export function foodAlternatives(reports:ScrapeReport[],retailer:string,itemId:string,request:string) {
 return reports.filter(r=>r.retailer!==retailer).flatMap(r=>r.lines.filter(l=>l.item.id===itemId).flatMap(l=>l.products.filter(p=>isCloseFood(request,p.name)).map(p=>({...p,sourceRetailer:r.retailer})))).slice(0,3);
}

