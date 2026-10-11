"use client";

import Link from "next/link";
import { useState } from "react";
import SketchIcon from "@/components/SketchIcon";

const foods = [
  { id: "eggs", name: "Large Eggs", store: "ALDI", cents: 249 },
  { id: "milk", name: "Whole Milk", store: "ALDI", cents: 319 },
  { id: "wings", name: "Chicken Wings", store: "Walmart", cents: 899 },
  { id: "rice", name: "Parboiled Rice", store: "Walmart", cents: 449 },
] as const;
const fuelCents = 240;
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export default function CartDemoPage() {
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const groceryCents = foods.reduce((sum, food) => sum + food.cents * (quantities[food.id] ?? 0), 0);
  const selected = foods.filter((food) => quantities[food.id]);
  function change(id: string, quantity: number) {
    setQuantities((current) => ({ ...current, [id]: Math.max(0, Math.min(99, quantity)) }));
  }

  return <main className="smart-cart-page">
    <div className="smart-cart-heading"><div><p className="eyebrow">INTERACTIVE EXAMPLE · SAMPLE PRICES</p>
      <h1>Try adding groceries</h1><p>These are the four illustrative prices you gave us. They are not current store prices or saved to your real cart.</p></div>
      <Link href="/plan/results">← Back to live search</Link></div>
    <div className="smart-cart-grid"><section className="smart-cart-stores" aria-label="Example products">
      {["ALDI", "Walmart"].map((store) => <article className="smart-cart-store" key={store}>
        <div className="smart-cart-store-head"><div><h2>{store}</h2><p>Example store · no branch selected</p></div></div>
        {foods.filter((food) => food.store === store).map((food) => <div className="smart-cart-line" key={food.id}>
          <SketchIcon name="bag" size={62} label="Example grocery item" />
          <div><strong>{food.name}</strong><small>{money(food.cents)} each · user-provided sample price</small></div>
          <div className="smart-cart-line-actions">{quantities[food.id] ? <>
            <label>Qty <input aria-label={`${food.name} quantity`} type="number" min="0" max="99"
              value={quantities[food.id]} onChange={(event) => change(food.id, Number(event.target.value))} /></label>
            <button type="button" onClick={() => change(food.id, 0)}>Remove</button>
          </> : <button className="demo-add" type="button" onClick={() => change(food.id, 1)}>Add to Cart +</button>}</div>
        </div>)}
      </article>)}
    </section><aside className="smart-cart-summary"><h2>Example cart</h2>
      {selected.length ? selected.map((food) => <p key={food.id}>{quantities[food.id]} × {food.name} <strong>{money(food.cents * quantities[food.id])}</strong></p>)
        : <p>Choose an item on the left to see it here.</p>}
      <p>Groceries <strong>{money(groceryCents)}</strong></p>
      <p>Illustrative driving fuel <strong>{money(fuelCents)}</strong></p>
      <p className="smart-cart-grand">Example total <strong>{money(groceryCents + fuelCents)}</strong></p>
      <p className="small">The $2.40 fuel figure is an example, not a route calculation. With all four items added once, the total is $21.56.</p>
      <Link className="cta" href="/plan/results">Find branch-priced products ↗</Link>
    </aside></div>
    <p className="smart-cart-gas">In live results: open a verified branch card, review a matching package, and click <strong>Add to Smart Cart</strong>. Online catalog listings without a branch price cannot be added to a priced trip.</p>
  </main>;
}
