import {describe,it,expect} from "vitest";
import {validDiscoveredSource} from "../lib/ai-source-search";
describe("AI source boundaries",()=>{
  it("requires an exact retailer product page and rejects unrelated stores and hostile URLs",()=>{
    expect(validDiscoveredSource("Publix","https://www.instacart.com/store/publix/products/123-eggs")).toBe(true);
    for(const url of ["https://www.instacart.com/store/aldi/products/123","https://www.instacart.com/store/publix/storefront","https://www.instacart.com.evil.test/store/publix/products/123","http://www.instacart.com/store/publix/products/123","https://user@www.instacart.com/store/publix/products/123"]){expect(validDiscoveredSource("Publix",url)).toBe(false);}
  });
});
