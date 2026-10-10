"use client";
import {useState} from "react";
import type {AgentItem} from "@/lib/price-agent";
import type {ScrapeReport,ScrapedProduct} from "@/lib/retailer-scraper";
function ProductPhoto({product}:{product:ScrapedProduct}) {
 const [failed,setFailed]=useState(false);
 return <div className="comparison-photo">{product.imageUrl && !failed ? <img src={product.imageUrl} alt={product.name} loading="lazy" referrerPolicy="no-referrer" onError={()=>setFailed(true)}/> : <span>Photo not supplied</span>}</div>;
}
export default function StoreColumns({reports,items}:{reports:ScrapeReport[];items:AgentItem[]}) {
 return <div className="store-comparison" role="region" aria-label="Compare foods across grocery stores" tabIndex={0}>{reports.map(report=><article className="store-column" key={report.retailer}>
 <div className="store-column-heading"><span className="eyebrow">GROCERY STORE</span><h3>{report.retailer}</h3><p>{report.lines.filter(l=>l.products.length).length} of {items.length} {items.length === 1 ? "item" : "items"} matched</p><span className="comparison-status">{report.status==="pending"?"Searching website…":report.status==="retrieved"?"Website prices":"Still needs a price source"}</span></div>
 {items.map(item=>{const line=report.lines.find(l=>l.item.id===item.id);const products=line?.products ?? [];const product=products[0];return <div className="comparison-food" key={item.id}><div className="comparison-request"><strong>{item.name}</strong><span>× {item.quantity}</span></div>{product ? <><ProductPhoto key={product.id} product={product}/><a href={product.sourceUrl} target="_blank" rel="noreferrer" className="comparison-product-name">{product.name} ↗</a><p className="comparison-size">{product.size}</p><strong className="comparison-price">${(product.priceCents/100).toFixed(2)}<small> / package</small></strong><p className="small">Recorded {new Date(product.retrievedAt).toLocaleString()}</p>{products.length>1 && <details><summary>{products.length-1} other packages</summary>{products.slice(1).map(p=><div className="comparison-alternative" key={p.id}><ProductPhoto product={p}/><a href={p.sourceUrl} target="_blank" rel="noreferrer">{p.name}</a><p>{p.size} · ${(p.priceCents/100).toFixed(2)}</p></div>)}</details>}</> : <div className="comparison-missing"><span> {report.status==="pending"?"Searching for this food…":"No verified match yet"}</span></div>}</div>;})}
 <footer><details><summary>Price source details</summary><p>{report.detail}</p></details></footer>
 </article>)}</div>;
}
