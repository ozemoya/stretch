// Backfill real branches only. Re-running cannot overwrite existing coordinates.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { resolveStoreCoordinates } from "../lib/store-coordinates.mjs";
const require = createRequire(import.meta.url);
const nextRequire = createRequire(require.resolve("next/package.json"));
nextRequire("@next/env").loadEnvConfig(fileURLToPath(new URL("../", import.meta.url)), true);
const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Configure server-only Supabase credentials in frontend/.env.local.");
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(10000) }) } });
const pending = [];
for (let offset = 0;; offset += 1000) {
  const { data, error } = await db.from("store").select("location_key,address")
    .eq("location_scope", "branch").is("latitude", null).is("longitude", null)
    .order("location_key").range(offset, offset + 999);
  if (error) throw new Error("Could not read locations for coordinate backfill.");
  pending.push(...data);
  if (data.length < 1000) break;
}
let located = 0, unresolved = 0;
for (const row of pending) {
  const point = await resolveStoreCoordinates({ address: row.address });
  if (!point) { unresolved++; console.log(`Unresolved: ${row.location_key} (no usable street-address match)`); continue; }
  const { data, error } = await db.from("store").update({ latitude: point.latitude, longitude: point.longitude })
    .eq("location_key", row.location_key).is("latitude", null).is("longitude", null).select("location_key");
  if (error) throw new Error(`Could not save coordinates for ${row.location_key}.`);
  located += data.length;
}
console.log(`Coordinate backfill: ${located} updated, ${unresolved} unresolved; catalog entries excluded.`);
if (unresolved) process.exitCode = 2;
