import { createClient } from "@supabase/supabase-js";

/** Read saved winners by the location primary key, or a legacy numeric alias. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const locationKey = params.get("locationKey"), locationId = params.get("locationId"), productId = params.get("productId");
  if ((!locationKey && !locationId) || (locationKey && locationId) ||
    (locationKey && locationKey.length > 420) || (locationId && !/^-?\d{1,16}$/.test(locationId)) ||
    (productId && productId.length > 80))
    return Response.json({ error: "Supply one locationKey or locationId, and an optional productId." }, { status: 400 });
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return Response.json({ error: "Saved price storage is not configured." }, { status: 503 });
  try {
    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(5000) }) } });
    let query = db.from("store_prices").select('location_key,location_scope,store,"sub-location",address,locationID,ID,category,requested_unit,product_name,package_size,price,unit_price,unit_basis,source_url,price_source,observed_at,id')
      .eq(locationKey ? "location_key" : "locationID", locationKey ?? locationId!)
      .order("observed_at", { ascending: false, nullsFirst: false }).limit(100);
    if (productId) query = query.eq("id", productId);
    const { data, error } = await query;
    if (error) throw error;
    const { data: location, error: locationError } = await db.from("store").select("latitude,longitude")
      .eq(locationKey ? "location_key" : "locationID", locationKey ?? locationId!).maybeSingle();
    if (locationError) throw locationError;
    return Response.json({ prices: (data ?? []).map(price => ({ ...price,
      latitude: location?.latitude ?? null, longitude: location?.longitude ?? null })) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Saved prices could not be loaded." }, { status: 502 });
  }
}
