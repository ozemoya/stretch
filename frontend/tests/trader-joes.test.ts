import {it,expect} from "vitest";
import {parseTraderJoesPage,traderJoesObserved} from "../lib/trader-joes";
const url="https://www.traderjoes.com/home/products/pdp/pasture-rasied-large-brown-egss-062124";
it("requires product-scoped price and package rather than recommendation prices",()=>{
 const html='<div><h1>Large Eggs</h1><span class="ProductPrice_productPrice__price_x">$5.99</span><span class="ProductPrice_productPrice__unit_x">/1 Doz</span></div><aside>$1.00</aside>';
 expect(parseTraderJoesPage(html,url)[0].priceCents).toBe(599);
 expect(parseTraderJoesPage('<h1>Eggs</h1><aside>$1.00</aside>',url)).toEqual([]);
 expect(parseTraderJoesPage(html,'https://example.com/products/eggs')).toEqual([]);
});
it("expires observations and retains their original evidence time",()=>{
 const item={id:'eggs',name:'eggs',unit:'dozen',quantity:1};
 const current=traderJoesObserved(item,Date.parse('2026-10-10T05:00:00Z'));
 expect(current[0].sourceUrl).toBe(url);
 expect(current[0].priceCents).toBe(599);
 expect(traderJoesObserved(item,Date.parse('2026-10-12T05:00:00Z'))).toEqual([]);
});
