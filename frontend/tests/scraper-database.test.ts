import { beforeAll, afterAll, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table product ("ID" numeric primary key, category text not null, count integer,
      price numeric not null, unit_price numeric, "locationID" numeric, store text, "sub-location" text);
    insert into product values (1,'eggs',12,1.79,1.79/12,1100672,'Kroger','Glenwood');`);
  await db.exec(readFileSync("supabase/setup.sql", "utf8"));
  for (const name of ["202610090002_product_store", "202610090003_store_metadata", "202610100001_product_date",
    "202610100002_product_dietary", "202610100003_retailer_price_observations", "202610100004_modular_scraper_prices"])
    await db.exec(readFileSync(`supabase/migrations/${name}.sql`, "utf8"));
  await db.exec(`create table public.branch_notes ("locationID" numeric not null references store("locationID"), note text);
    insert into branch_notes values (1100672,'Legacy branch note');
    create table public.branch_tags (location_key text, tag text);
    insert into branch_tags values ('kroger:branch:1100672','Atlanta');`);
  await db.exec(readFileSync("supabase/migrations/202610100005_store_location_key.sql", "utf8"));
}, 20000);
afterAll(async () => { await db?.close(); });
const location = (retailer: string, scope = "branch") => ({ retailer_key: retailer, scope, source_id: "1100672",
  name: retailer === "kroger" ? "Kroger" : retailer, label: "Atlanta" });
const price = (cents = 199, at = new Date().toISOString()) => ({ search_key: '["eggs","count",12]', category: "eggs",
  product_name: "Large eggs", source_product_id: "eggs-1", package_size: "12 ct", requested_unit: "1 dozen",
  catalog_item_id: "eggs", count: 12, price_cents: cents, unit_price: cents / 1200, unit_basis: "each",
  price_source: "Official API", observed_at: at });
const save = (loc: ReturnType<typeof location>, rows = [price()]) => db.query<{ location_id: string; product_id: string }>(
  "select * from save_store_prices($1::jsonb,$2::jsonb)", [JSON.stringify(loc), JSON.stringify(rows)]);

it("reuses legacy Kroger IDs and allocates disjoint IDs for different retailers and catalog scopes", async () => {
  const kroger = (await save(location("kroger"))).rows[0];
  const target = (await save(location("target"))).rows[0];
  const catalog = (await save(location("target", "catalog"))).rows[0];
  expect(kroger.location_id).toBe("1100672");
  expect(Number(target.location_id)).toBeLessThan(0);
  expect(new Set([kroger.location_id, target.location_id, catalog.location_id]).size).toBe(3);
  const repeats = await Promise.all([save(location("target")), save(location("target"))]);
  expect(repeats.map(result => result.rows[0].location_id)).toEqual([target.location_id, target.location_id]);
  expect(repeats.map(result => result.rows[0].product_id)).toEqual([target.product_id, target.product_id]);
  expect((await db.query("select * from store_prices where location_key = 'target:branch:1100672'")).rows).toHaveLength(1);
});

it("accepts newer prices, rejects stale overwrites, and rolls back an entire invalid batch", async () => {
  const loc = location("freshness"), current = Date.now();
  await save(loc, [price(199, new Date(current - 10000).toISOString())]);
  await save(loc, [price(249, new Date(current).toISOString())]);
  await save(loc, [price(99, new Date(current - 5000).toISOString())]);
  const value = await db.query<{ price: string }>("select price from store_prices where location_key='freshness:branch:1100672'");
  expect(Number(value.rows[0].price)).toBe(2.49);
  await expect(save(location("invalid"), [price(), { ...price(), price_cents: -1 }])).rejects.toThrow();
  expect((await db.query("select * from store where retailer_key='invalid'")).rows).toHaveLength(0);
  await expect(db.exec("update store set location_key='target:branch:other' where retailer_key='target'")).rejects.toThrow();
});

it("denies public callers permission to save prices", async () => {
  await db.exec("set role anon");
  try {
    expect((await db.query("select * from store_prices where location_key='target:branch:1100672'")).rows).toHaveLength(1);
    await expect(save(location("unauthorized"))).rejects.toThrow("permission denied");
    await expect(db.exec("update product set price=0")).rejects.toThrow("permission denied");
  }
  finally { await db.exec("reset role"); }
});

it("lets the scraper service role save and read prices joined by location_key", async () => {
  await db.exec("set role service_role");
  try {
    await save(location("service-test"));
    const saved = await db.query<{ location_key: string; price: string }>(
      "select location_key,price from store_prices where location_key='service-test:branch:1100672'");
    expect(saved.rows).toHaveLength(1);
    expect(saved.rows[0].location_key).toBe("service-test:branch:1100672");
    expect(Number(saved.rows[0].price)).toBe(1.99);
  } finally { await db.exec("reset role"); }
});

it("makes location_key the primary key and migrates every store reference without losing rows", async () => {
  const primary = await db.query<{ column_name: string }>(`select a.attname as column_name
    from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attnum=any(c.conkey)
    where c.conrelid='public.store'::regclass and c.contype='p'`);
  expect(primary.rows).toEqual([{ column_name: "location_key" }]);
  const references = await db.query<{ column_name: string }>(`select a.attname as column_name
    from pg_constraint c join pg_attribute a on a.attrelid=c.confrelid and a.attnum=any(c.confkey)
    where c.confrelid='public.store'::regclass and c.contype='f'`);
  expect(references.rows).toHaveLength(3);
  expect(references.rows.every(row => row.column_name === "location_key")).toBe(true);
  expect((await db.query("select location_key from branch_notes")).rows).toEqual([{ location_key: "kroger:branch:1100672" }]);
  expect((await db.query('select location_key from product where "ID"=1')).rows).toEqual([{ location_key: "kroger:branch:1100672" }]);
  await expect(db.exec("insert into branch_tags values ('unknown:branch:1','bad')")).rejects.toThrow();
  await expect(db.exec("delete from store where location_key='kroger:branch:1100672'")).rejects.toThrow();
  await expect(db.exec("insert into branch_notes values (1100672,'mismatch','target:branch:1100672')")).rejects.toThrow();
  await db.exec("insert into branch_notes(location_key,note) values ('kroger:branch:1100672','Canonical write')");
  expect((await db.query('select "locationID" from branch_notes where note=\'Canonical write\'')).rows).toEqual([{ locationID: "1100672" }]);
});

