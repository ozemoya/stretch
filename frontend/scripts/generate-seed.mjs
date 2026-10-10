import fs from "node:fs";
const c = JSON.parse(
  fs.readFileSync(
    new URL("../lib/sample-catalog.json", import.meta.url),
    "utf8",
  ),
);
const q = (v) =>
  typeof v === "boolean"
    ? String(v)
    : typeof v === "number"
      ? String(v)
      : "'" + v.replaceAll("'", "''") + "'";
const insert = (table, columns, rows) =>
  `insert into public.${table} (${columns.join(",")}) values\n${rows.map((r) => "(" + r.map(q).join(",") + ")").join(",\n")}\non conflict (id) do nothing;\n`;
const sql =
  insert(
    "stores",
    ["id", "name"],
    c.stores.map((s) => [s.id, s.name]),
  ) +
  insert(
    "products",
    [
      "id",
      "name",
      "emoji",
      "category",
      "unit",
      "vegan",
      "gluten_free",
      "nut_free",
    ],
    c.products.map((p) => [
      p.id,
      p.name,
      p.emoji,
      p.category,
      p.unit,
      p.vegan,
      p.glutenFree,
      p.nutFree,
    ]),
  ) +
  insert(
    "offers",
    [
      "id",
      "product_id",
      "store_id",
      "price_cents",
      "recorded_at",
      "is_sample",
      "available",
    ],
    c.offers.map((o) => [
      o.productId + "-" + o.storeId,
      o.productId,
      o.storeId,
      o.priceCents,
      o.recordedAt,
      o.isSample,
      o.available,
    ]),
  ) +
  insert(
    "substitutions",
    ["id", "from_id", "to_id", "note"],
    c.swaps.map((s) => [s.fromId + "-" + s.toId, s.fromId, s.toId, s.note]),
  );
fs.writeFileSync(new URL("../supabase/seed.sql", import.meta.url), sql);
fs.writeFileSync(
  new URL("../supabase/setup.sql", import.meta.url),
  fs.readFileSync(
    new URL("../supabase/migrations/202610090001_catalog.sql", import.meta.url),
    "utf8",
  ) +
    "\n" +
    sql,
);
console.log(
  `Generated ${c.products.length} products and ${c.offers.length} sample offers.`,
);
