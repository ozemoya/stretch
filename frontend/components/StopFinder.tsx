"use client";
import {useEffect,useState} from "react";
import OpenMap from "./OpenMap";
import {originQuery,type SearchOrigin} from "@/lib/locations";
import type {Area,NearbyPlace,FuelQuote,LocalFuelResult} from "@/lib/live-data";
export default function StopFinder({area,origin,onFuel,autoLoad=false}:{area:Area;origin:SearchOrigin|null;onFuel:(quote:FuelQuote)=>void;autoLoad?:boolean}) {
  const [radius,setRadius]=useState(5),[kind,setKind]=useState("all"),[places,setPlaces]=useState<NearbyPlace[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const [prices,setPrices]=useState<LocalFuelResult|null>(null),[priceBusy,setPriceBusy]=useState(false),[priceError,setPriceError]=useState("");
  const [loaded,setLoaded]=useState(false);
  const [attempt,setAttempt]=useState(0);
  useEffect(()=>{
    if(!autoLoad && !attempt)return;
    const controller=new AbortController();setBusy(true);setError("");setLoaded(false);setPlaces([]);
    fetch(`/api/live/places?area=${area}&radius=${radius}&kind=all${originQuery(origin)}`,{signal:controller.signal}).then(async r=>{const data=await r.json();if(!r.ok)throw new Error(data.error||"Location search failed. Retry your search.");return data;}).then(data=>{if(!controller.signal.aborted){setPlaces(data.places);setLoaded(true);}}).catch(e=>{if(!controller.signal.aborted)setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setBusy(false);});
    return ()=>controller.abort();
  },[area,origin?.lat,origin?.lon,radius,attempt,autoLoad]);
  async function checkFuel(){setPriceBusy(true);setPriceError("");try{const r=await fetch(`/api/live/local-fuel?area=${area}&radius=${radius}&type=REGULAR_UNLEADED${originQuery(origin)}`,{signal:AbortSignal.timeout(30000)});const data=await r.json();if(!r.ok)throw new Error(data.error||"Pump-price search failed.");setPrices(data);}catch(e){setPriceError(e instanceof Error?e.message:"Pump-price search failed.");}finally{setPriceBusy(false);}}
  const visible=places.filter(p=>kind==="all"||p.kind===kind);
  return <article className="stop-finder">
    <p className="eyebrow">GROCERIES + GAS · ONE GOOD ROUTE</p><h2 id="live-title">Find your next stop.</h2>
    <p>See nearby grocery stores and gas stations together. Start with your list, then choose the stops that work for your trip.</p>
    <div className="stop-toolbar"><label>Search radius<select value={radius} onChange={e=>{setRadius(Number(e.target.value));setPrices(null);}}>{[1,2,3,5,10].map(n=><option key={n} value={n}>{n} miles</option>)}</select></label><div className="search-filters">{[["all","All stops"],["grocery","Groceries"],["fuel","Gas stations"]].map(([value,label])=><button type="button" key={value} aria-pressed={kind===value} onClick={()=>setKind(value)}>{label}</button>)}</div><button type="button" disabled={busy} onClick={()=>setAttempt(n=>n+1)}>{busy?"Finding your stops…":"Refresh stops ↗"}</button></div>
    {error && <p role="alert">{error}</p>}
    <div className="next-stop-map"><OpenMap area={area} origin={origin} radius={radius} places={visible}/></div>
    <p role="status">{busy?"Loading groceries and gas stations…":`${visible.length} mapped stops within ${radius} miles of ${origin?.label||area}.`}</p>
    {loaded&&!visible.length&&<p>No mapped stops matched this filter. Try a wider radius.</p>}
    <ul className="stop-results">{visible.map(p=><li key={p.id}><span className={p.kind==="fuel"?"stop-dot fuel":"stop-dot"}/><div><a href={p.mapUrl} target="_blank" rel="noreferrer">{p.name} ↗</a><small>{p.kind==="fuel"?"Gas station":"Grocery stop"} · {p.miles} mi · {p.address||"Address not supplied"}</small></div></li>)}</ul>
    <details><summary>Check reported pump prices</summary><p>Map locations do not include pump prices. Search the connected price provider for reported regular-gas prices.</p><button type="button" disabled={priceBusy} onClick={checkFuel}>{priceBusy?"Checking pump reports…":"Check pump prices"}</button>{priceError&&<p role="alert">{priceError}</p>}{prices?.stations.map(s=><div className="live-card" key={s.id}><strong>{s.name}</strong><p>{s.dollarsPerGallon===null?"No pump report returned":`$${s.dollarsPerGallon.toFixed(3)} / gallon`}</p><button type="button" disabled={s.stale||s.dollarsPerGallon===null||!s.updatedAt} onClick={()=>onFuel({kind:"station",stationName:s.name,dollarsPerGallon:s.dollarsPerGallon!,period:s.updatedAt!,retrievedAt:prices.retrievedAt,sourceUrl:s.mapUrl,region:s.address})}>Use this station price</button></div>)}</details>
    <p className="small">OpenStreetMap locations can be incomplete. Distances are straight-line estimates; grocery and pump prices require separate verified sources.</p>
  </article>;
}
