"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { BasketItem, Catalog } from "@/lib/types";
import { createSavedList, readSavedLists, readSavedSettings, writeSavedLists, type SavedList } from "@/lib/saved-plans";
import SketchIcon from "./SketchIcon";

export default function ListsPage({ catalog }: { catalog: Catalog }) {
  const [lists, setLists] = useState<SavedList[]>([]);
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [newListName, setNewListName] = useState("");
  const [newListSearch, setNewListSearch] = useState("");
  const [newListBasket, setNewListBasket] = useState<BasketItem[]>([]);
  const [editingListId, setEditingListId] = useState<string | null>(null);
  const [editListName, setEditListName] = useState("");
  const [editListSearch, setEditListSearch] = useState("");
  const [editListBasket, setEditListBasket] = useState<BasketItem[]>([]);

  useEffect(() => {
    setLists(readSavedLists(window.localStorage));
    setReady(true);
  }, []);

  function removeList(id: string) {
    const next = lists.filter((list) => list.id !== id);
    if (!writeSavedLists(window.localStorage, next)) {
      setNotice("This browser could not remove the saved list.");
      return;
    }
    setLists(next);
    setNotice("Saved list removed.");
  }

  function changeNewListQuantity(productId: string, amount: number) {
    setNewListBasket((current) => {
      const quantity = Math.min(99, Math.max(0, (current.find((item) => item.productId === productId)?.quantity ?? 0) + amount));
      return [...current.filter((item) => item.productId !== productId), ...(quantity ? [{ productId, quantity }] : [])];
    });
  }

  function changeEditListQuantity(productId: string, amount: number) {
    setEditListBasket((current) => {
      const quantity = Math.min(99, Math.max(0, (current.find((item) => item.productId === productId)?.quantity ?? 0) + amount));
      return [...current.filter((item) => item.productId !== productId), ...(quantity ? [{ productId, quantity }] : [])];
    });
  }

  function startEditing(list: SavedList) {
    setIsCreating(false);
    setEditingListId(list.id);
    setEditListName(list.name);
    setEditListSearch("");
    setEditListBasket(list.basket.map((item) => ({ ...item })));
  }

  function cancelEditing() {
    setEditingListId(null);
    setEditListName("");
    setEditListSearch("");
    setEditListBasket([]);
  }

  function saveEditedList() {
    if (!editingListId) return;
    const current = lists.find((list) => list.id === editingListId);
    if (!current) return;
    const updated = createSavedList(current.id, editListName || "My grocery list", editListBasket, {
      prefs: current.prefs,
      manualOrigin: current.manualOrigin,
    }, current.savedAt);
    if (!updated) {
      setNotice("Add at least one food before saving your list.");
      return;
    }
    const next = lists.map((list) => list.id === current.id ? updated : list);
    if (!writeSavedLists(window.localStorage, next)) {
      setNotice("This browser could not update the list. Check storage permissions.");
      return;
    }
    setLists(next);
    cancelEditing();
    setNotice(`Updated “${updated.name}”.`);
  }

  function saveNewList() {
    if (lists.length >= 20) {
      setNotice("You have 20 saved lists. Remove one before saving another.");
      return;
    }
    const settings = readSavedSettings(window.localStorage) ?? {
      prefs: { area: "downtown" as const, budget: 35, mpg: 25, gas: 3.5, maxStops: 2, vegan: false, glutenFree: false, nutFree: false },
      manualOrigin: null,
    };
    const list = createSavedList(crypto.randomUUID(), newListName || "My grocery list", newListBasket, settings);
    if (!list) {
      setNotice("Add at least one food before saving your list.");
      return;
    }
    const next = [list, ...lists];
    if (!writeSavedLists(window.localStorage, next)) {
      setNotice("This browser could not save the list. Check storage permissions.");
      return;
    }
    setLists(next);
    setIsCreating(false);
    setNewListName("");
    setNewListSearch("");
    setNewListBasket([]);
    setNotice(`Saved “${list.name}” on this device.`);
  }

  const newListProducts = catalog.products.filter((product) =>
    `${product.name} ${product.category}`.toLowerCase().includes(newListSearch.trim().toLowerCase()),
  );
  const editListProducts = catalog.products.filter((product) =>
    `${product.name} ${product.category}`.toLowerCase().includes(editListSearch.trim().toLowerCase()),
  );

  return (
    <main className="lists-page">
      <div className="lists-heading">
        <div>
          <p className="eyebrow">YOUR COLLECTION</p>
          <h1>Saved grocery lists</h1>
          <p>Keep the lists you use most and bring one back whenever it is time to shop.</p>
        </div>
        <button className="desktop-primary" type="button" onClick={() => setIsCreating(true)}>New grocery list <span>＋</span></button>
      </div>
      {isCreating && (
        <section className="list-creator" aria-labelledby="list-creator-title">
          <div className="list-creator-heading">
            <div>
              <p className="eyebrow">MAKE A NEW COLLECTION</p>
              <h2 id="list-creator-title">Create a grocery list</h2>
              <p>Add what you need, give the list a name, and save it here.</p>
            </div>
            <button type="button" className="list-creator-close" onClick={() => setIsCreating(false)}>Cancel</button>
          </div>
          <div className="list-creator-fields">
            <label htmlFor="new-list-name">List name
              <input id="new-list-name" value={newListName} maxLength={60} placeholder="Weekly groceries" onChange={(event) => setNewListName(event.target.value)} />
            </label>
            <label htmlFor="new-list-search">Find groceries
              <input id="new-list-search" type="search" value={newListSearch} placeholder="Search milk, bread, apples…" onChange={(event) => setNewListSearch(event.target.value)} />
            </label>
          </div>
          <div className="list-creator-layout">
            <div className="list-creator-products">
              {newListProducts.map((product) => {
                const quantity = newListBasket.find((item) => item.productId === product.id)?.quantity ?? 0;
                return <article className={quantity ? "creator-product added" : "creator-product"} key={product.id}>
                  <div><strong>{product.name}</strong><small>{product.unit}</small></div>
                  <button type="button" onClick={() => changeNewListQuantity(product.id, 1)} disabled={quantity === 99}>{quantity ? `${quantity} +` : "＋"}</button>
                </article>;
              })}
              {!newListProducts.length && <p className="lists-muted">No groceries match that search.</p>}
            </div>
            <aside className="list-creator-summary">
              <p className="eyebrow">YOUR NEW LIST</p>
              <strong>{newListBasket.length} {newListBasket.length === 1 ? "item" : "items"}</strong>
              {newListBasket.length ? <ul>{newListBasket.map((item) => {
                const product = catalog.products.find((entry) => entry.id === item.productId);
                return product ? <li key={item.productId}><span>{product.name}</span><span><small>×{item.quantity}</small> <button type="button" aria-label={`Remove ${product.name}`} onClick={() => changeNewListQuantity(product.id, -item.quantity)}>×</button></span></li> : null;
              })}</ul> : <p className="lists-muted">Choose groceries from the catalog.</p>}
              <button type="button" className="desktop-primary" disabled={!newListBasket.length} onClick={saveNewList}>Save list <span>↗</span></button>
            </aside>
          </div>
        </section>
      )}
      <div className="lists-toolbar">
        <span>{ready ? `${lists.length} of 20 lists saved` : "Loading your lists…"}</span>
        <span>Saved on this device · prices refresh each trip</span>
      </div>
      {ready && lists.length ? (
        <div className="saved-list-grid">
          {lists.map((list) => (
            <article className="saved-list-card" key={list.id}>
              <div className="saved-list-card-top">
                <span className="list-symbol"><SketchIcon name="bag" size={32} /></span>
                <span className="status-pill">Saved list</span>
              </div>
              {editingListId === list.id ? (
                <div className="saved-list-editor">
                  <label htmlFor={`edit-list-name-${list.id}`}>List name
                    <input id={`edit-list-name-${list.id}`} value={editListName} maxLength={60} onChange={(event) => setEditListName(event.target.value)} />
                  </label>
                  <label htmlFor={`edit-list-search-${list.id}`}>Find groceries
                    <input id={`edit-list-search-${list.id}`} type="search" value={editListSearch} placeholder="Search groceries…" onChange={(event) => setEditListSearch(event.target.value)} />
                  </label>
                  <div className="saved-list-editor-products">
                    {editListProducts.map((product) => {
                      const quantity = editListBasket.find((item) => item.productId === product.id)?.quantity ?? 0;
                      return <div className={quantity ? "creator-product added" : "creator-product"} key={product.id}>
                        <div><strong>{product.name}</strong><small>{product.unit}</small></div>
                        <button type="button" onClick={() => changeEditListQuantity(product.id, 1)} disabled={quantity === 99}>{quantity ? `${quantity} +` : "＋"}</button>
                      </div>;
                    })}
                  </div>
                  <p className="saved-list-editor-count">{editListBasket.length} {editListBasket.length === 1 ? "item" : "items"} selected</p>
                  <div className="saved-list-card-actions">
                    <button className="desktop-primary" type="button" disabled={!editListBasket.length} onClick={saveEditedList}>Save changes <span>↗</span></button>
                    <button type="button" onClick={cancelEditing}>Cancel</button>
                  </div>
                </div>
              ) : (
                <>
                  <h2>{list.name}</h2>
                  <p className="saved-list-date">Saved {new Date(list.savedAt).toLocaleDateString()}</p>
                  <ul className="saved-list-items">
                    {list.basket.slice(0, 5).map((item) => {
                      const product = catalog.products.find((entry) => entry.id === item.productId);
                      return product ? <li key={item.productId}><span>{product.name}</span><small>×{item.quantity}</small></li> : null;
                    })}
                    {list.basket.length > 5 && <li className="saved-list-more">+ {list.basket.length - 5} more items</li>}
                  </ul>
                  <div className="saved-list-card-actions">
                    <Link className="desktop-primary" href={`/plan?listId=${encodeURIComponent(list.id)}`}>Use this list <span>↗</span></Link>
                    <button type="button" onClick={() => startEditing(list)}>Edit</button>
                    <button type="button" onClick={() => removeList(list.id)}>Remove</button>
                  </div>
                </>
              )}
            </article>
          ))}
        </div>
      ) : ready ? (
        <section className="lists-empty">
          <SketchIcon name="bag" size={76} />
          <h2>No saved lists yet</h2>
          <p>Build a grocery list once, save it here, and reuse it for your next trip.</p>
          <button className="desktop-primary" type="button" onClick={() => setIsCreating(true)}>Create your first list <span>＋</span></button>
        </section>
      ) : null}
      {notice && <p className="lists-notice" role="status">{notice}</p>}
    </main>
  );
}
