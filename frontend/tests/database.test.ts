import { it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
it("applies schema and seed, permits anonymous catalog reads and rejects writes", async () => {
  const db = new PGlite();
  await db.exec("create role anon; create role authenticated;");
  await db.exec(readFileSync("supabase/setup.sql", "utf8"));
  await db.exec("set role anon;");
  const data = await db.query<{ count: number }>(
    "select count(*)::int as count from products",
  );
  expect(data.rows[0].count).toBe(30);
  for (const sql of [
    "insert into stores values ('evil','Changed')",
    "update stores set name='Changed'",
    "delete from offers",
  ]) {
    await expect(db.exec(sql)).rejects.toThrow();
  }
  await db.exec("reset role; set role authenticated;");
  expect((await db.query("select * from offers")).rows).toHaveLength(90);
  await expect(db.exec("delete from products")).rejects.toThrow();
  await db.close();
}, 20000);
