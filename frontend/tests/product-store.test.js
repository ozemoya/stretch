import { it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  "supabase/migrations/202610090002_product_store.sql",
  "utf8",
);
const metadataMigration = readFileSync(
  "supabase/migrations/202610090003_store_metadata.sql",
  "utf8",
);
const dateMigration = readFileSync(
  "supabase/migrations/202610100001_product_date.sql",
  "utf8",
);
async function fixture() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table product ("ID" numeric primary key, category text not null, count integer,
      price numeric not null, unit_price numeric, "locationID" numeric, store text, "sub-location" text);
    insert into product values
      (1,'eggs',12,1.79,1.79/12,1100672,'Kroger','Glenwood'),
      (2,'eggs',30,5.19,5.19/30,1100672,'Kroger','Glenwood'),
      (3,'whole milk',128,3.29,3.29/128,1100695,'Kroger','Ponce');`);
  return db;
}

it("adds nullable dietary booleans without inventing claims or changing existing prices", async () => {
  const db = await fixture();
  try {
    const before = (await db.query('select * from product order by "ID"')).rows;
    await db.exec(
      readFileSync(
        "supabase/migrations/202610100002_product_dietary.sql",
        "utf8",
      ),
    );
    const after = (await db.query('select * from product order by "ID"')).rows;
    expect(
      after.map(({ gluten_free, vegan, nut_free, ...row }) => row),
    ).toEqual(before);
    expect(
      after.every(
        (row) =>
          row.gluten_free === null &&
          row.vegan === null &&
          row.nut_free === null,
      ),
    ).toBe(true);
    await db.exec(
      'update product set gluten_free=true,vegan=false,nut_free=null where "ID"=1',
    );
    expect(
      (
        await db.query(
          'select gluten_free,vegan,nut_free from product where "ID"=1',
        )
      ).rows[0],
    ).toEqual({ gluten_free: true, vegan: false, nut_free: null });
    const types = (
      await db.query(
        "select data_type from information_schema.columns where table_name='product' and column_name in ('gluten_free','vegan','nut_free')",
      )
    ).rows;
    expect(types).toHaveLength(3);
    expect(types.every((row) => row.data_type === "boolean")).toBe(true);
  } finally {
    await db.close();
  }
}, 20000);

it("adds a real date column without inventing update dates or changing existing product values", async () => {
  const db = await fixture();
  try {
    const before = (await db.query('select * from product order by "ID"')).rows;
    await db.exec(dateMigration);
    const after = (await db.query('select * from product order by "ID"')).rows;
    expect(after.map(({ date, ...row }) => row)).toEqual(before);
    expect(after.every((row) => row.date === null)).toBe(true);
    const column = (
      await db.query(
        "select data_type from information_schema.columns where table_schema='public' and table_name='product' and column_name='date'",
      )
    ).rows[0];
    expect(column.data_type).toBe("date");
    await db.query('update product set date=$1 where "ID"=1', ["2026-10-09"]);
    await db.query('update product set date=$1,price=$2 where "ID"=1', [
      "2026-10-10",
      2.19,
    ]);
    const updated = (
      await db.query('select "ID",date::text,price from product where "ID"=1')
    ).rows[0];
    expect(updated).toMatchObject({
      ID: "1",
      date: "2026-10-10",
      price: "2.19",
    });
    await expect(
      db.exec("update product set date='not-a-date'"),
    ).rejects.toThrow();
  } finally {
    await db.close();
  }
}, 20000);

it("moves names once per location, preserves products, and enforces the store link", async () => {
  const db = await fixture();
  try {
    const before = (await db.query('select * from product order by "ID"')).rows;
    await db.exec(migration);
    expect((await db.query("select * from store")).rows).toHaveLength(2);
    const after = (
      await db.query(
        'select p.*, s.store, s."sub-location" from product p join store s using ("locationID") order by p."ID"',
      )
    ).rows;
    expect(after).toEqual(before);
    const columns = (
      await db.query(
        "select column_name from information_schema.columns where table_name='product'",
      )
    ).rows.map((r) => r.column_name);
    expect(columns).not.toContain("store");
    expect(columns).not.toContain("sub-location");
    await expect(
      db.exec('update product set "locationID"=999 where "ID"=1'),
    ).rejects.toThrow();
    await expect(
      db.exec('delete from store where "locationID"=1100672'),
    ).rejects.toThrow();
    await db.exec("set role anon");
    expect((await db.query("select * from store")).rows).toHaveLength(2);
    await expect(db.exec("delete from store")).rejects.toThrow();
    await db.exec("reset role; set role authenticated");
    await expect(
      db.exec("insert into store values (123,'Changed',null)"),
    ).rejects.toThrow();
  } finally {
    await db.close();
  }
}, 20000);

it("adds optional metadata without changing products and validates coordinate ranges", async () => {
  const db = await fixture();
  try {
    await db.exec(migration);
    const products = (await db.query('select * from product order by "ID"'))
      .rows;
    await db.exec(metadataMigration);
    expect(
      (await db.query("select latitude,longitude,address from store")).rows,
    ).toEqual([
      { latitude: null, longitude: null, address: null },
      { latitude: null, longitude: null, address: null },
    ]);
    await db.query(
      'update store set latitude=$1,longitude=$2,address=$3 where "locationID"=$4',
      [33.742558, -84.35962, "800 Glenwood Ave SE, Atlanta, GA 30316", 1100672],
    );
    expect(
      (await db.query('select * from product order by "ID"')).rows,
    ).toEqual(products);
    await expect(db.exec("update store set latitude=91")).rejects.toThrow();
    await expect(db.exec("update store set longitude=-181")).rejects.toThrow();
    await expect(
      db.exec("update store set latitude=0,longitude=null"),
    ).rejects.toThrow();
    await db.exec("set role anon");
    expect(
      (await db.query('select address from store where "locationID"=1100672'))
        .rows[0].address,
    ).toBe("800 Glenwood Ave SE, Atlanta, GA 30316");
    await expect(
      db.exec("update store set latitude=0,longitude=0"),
    ).rejects.toThrow();
  } finally {
    await db.close();
  }
}, 20000);

it("rolls back when one location has conflicting store names", async () => {
  const db = await fixture();
  try {
    await db.exec(
      'update product set "sub-location"=\'Other branch\' where "ID"=2',
    );
    await expect(db.exec(migration)).rejects.toThrow("Conflicting store names");
    await db.exec("rollback");
    expect((await db.query("select * from product")).rows).toHaveLength(3);
    expect(
      (await db.query("select to_regclass('public.store') as table_name"))
        .rows[0].table_name,
    ).toBeNull();
  } finally {
    await db.close();
  }
}, 20000);

it("refuses to discard names on a product without a locationID", async () => {
  const db = await fixture();
  try {
    await db.exec('update product set "locationID"=null where "ID"=1');
    await expect(db.exec(migration)).rejects.toThrow("without locationID");
    await db.exec("rollback");
    expect(
      (await db.query('select store from product where "ID"=1')).rows[0].store,
    ).toBe("Kroger");
  } finally {
    await db.close();
  }
}, 20000);
