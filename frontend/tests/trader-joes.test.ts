import {it,expect,vi} from "vitest";
import {parseTraderJoesPage,parseTraderJoesCatalog,traderJoesObserved,traderJoesReport} from "../lib/trader-joes";
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
it("finds a same-retailer chicken counterpart with a real catalog price",()=>{
 const item={id:"chicken",name:"Chicken",unit:"1 lb",quantity:1};
 const products=parseTraderJoesCatalog([
  {sku:"060667",item_title:"Shawarma Chicken Thighs",retail_price:"6.99",sales_size:1,sales_uom_description:"Lb",availability:"1",published:1,primary_image:"/content/dam/trjo/products/chicken.png"},
  {sku:"012345",item_title:"Chicken Noodle Soup",retail_price:"2.99",sales_size:15,sales_uom_description:"Oz",availability:"1",published:1},
  {sku:"012346",item_title:"Chicken Breast",retail_price:null,sales_size:1,sales_uom_description:"Lb",availability:"1",published:1},
 ],item);
 expect(products.map(product=>product.name)).toEqual(["Shawarma Chicken Thighs"]);
 expect(products[0]).toMatchObject({priceCents:699,size:"1 Lb",sourceUrl:"https://www.traderjoes.com/home/products/pdp/060667"});
});
it("uses the official catalog response and does not invent a price on failure",async()=>{
 const fetchMock=vi.spyOn(globalThis,"fetch").mockResolvedValueOnce(new Response(JSON.stringify({data:{products:{page_info:{total_pages:1},items:[
  {sku:"060667",item_title:"Shawarma Chicken Thighs",retail_price:"6.99",sales_size:1,sales_uom_description:"Lb",availability:"1",published:1},
 ]}}}),{status:200}));
 try {
  const report=await traderJoesReport([{id:"chicken-api-test",name:"Chicken",unit:"1 lb",quantity:1}]);
  expect(report.lines[0].products[0].priceCents).toBe(699);
  expect(fetchMock).toHaveBeenCalledWith("https://www.traderjoes.com/api/graphql",expect.objectContaining({method:"POST"}));
 } finally {fetchMock.mockRestore();}
});
