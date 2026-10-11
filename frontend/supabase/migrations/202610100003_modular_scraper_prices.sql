-- Keep legacy numeric IDs; new IDs come from a separate, database-owned range.
begin;
lock table public.store, public.product in access exclusive mode;

create sequence public.scraper_location_ids increment by -1 minvalue -9007199254740991 maxvalue -1 start -1;
create sequence public.scraper_product_ids increment by -1 minvalue -9007199254740991 maxvalue -1 start -1;
select setval('public.scraper_location_ids', least(-1, coalesce(min("locationID"), 0) - 1)::bigint, false) from public.store;
select setval('public.scraper_product_ids', least(-1, coalesce(min("ID"), 0) - 1)::bigint, false) from public.product;

alter table public.store
  alter column "locationID" set default nextval('public.scraper_location_ids'),
  add column location_key text,
  add column retailer_key text,
  add column location_scope text not null default 'branch' check (location_scope in ('branch','catalog')),
  add column source_location_id text;

update public.store set
  retailer_key = case when store = 'Kroger' then 'kroger' else 'legacy' end,
  source_location_id = "locationID"::text;
update public.store set location_key = retailer_key || ':branch:' || source_location_id;
alter table public.store
  alter column location_key set not null,
  alter column retailer_key set not null,
  alter column source_location_id set not null,
  add constraint store_location_key_unique unique (location_key),
  add constraint store_location_identity_unique unique (retailer_key, location_scope, source_location_id),
  add constraint store_location_key_shape check (location_key = retailer_key || ':' || location_scope || ':' || source_location_id);

-- Legacy Kroger scripts may still supply their numeric native IDs. Preserve that identity.
create function public.guard_store_identity() returns trigger language plpgsql set search_path = public as $$
begin
  if new.location_key is null then
    new.retailer_key := case when new.store = 'Kroger' then 'kroger' else 'legacy' end;
    new.location_scope := 'branch';
    new.source_location_id := new."locationID"::text;
    new.location_key := new.retailer_key || ':branch:' || new.source_location_id;
  end if;
  if tg_op = 'UPDATE' and (new."locationID" is distinct from old."locationID" or
      new.location_key is distinct from old.location_key or new.retailer_key is distinct from old.retailer_key or
      new.location_scope is distinct from old.location_scope or new.source_location_id is distinct from old.source_location_id or
      new.store is distinct from old.store) then
    raise exception 'A location identity cannot be overwritten by another store';
  end if;
  return new;
end $$;
create trigger store_identity_guard before insert or update on public.store
  for each row execute function public.guard_store_identity();

alter table public.product
  alter column "ID" set default nextval('public.scraper_product_ids'),
  add column if not exists id text references public.products(id);
alter table public.product
  add column search_key text,
  add column requested_unit text,
  add column product_name text,
  add column source_product_id text,
  add column package_size text,
  add column unit_basis text,
  add column source_url text,
  add column price_source text,
  add column observed_at timestamptz,
  add constraint product_location_search_key_unique unique ("locationID", search_key);

-- One transaction per location. Natural-key conflicts reuse existing IDs, including under concurrency.
create function public.save_store_prices(p_location jsonb, p_prices jsonb)
returns table(location_id numeric, product_id numeric, search_key text)
language plpgsql security invoker set search_path = public as $$
declare
  loc numeric;
  row jsonb;
  identity_key text;
  observed timestamptz;
begin
  if jsonb_typeof(p_prices) <> 'array' or jsonb_array_length(p_prices) not between 1 and 30 or
    coalesce(p_location->>'retailer_key','') !~ '^[a-z0-9%_''.-]+$' or
    length(coalesce(p_location->>'retailer_key','')) > 160 or
    coalesce(p_location->>'scope','') not in ('branch','catalog') or
    length(coalesce(p_location->>'source_id','')) not between 1 and 240 or
    length(coalesce(p_location->>'name','')) not between 1 and 200 then
    raise exception 'Invalid location or price batch';
  end if;
  identity_key := (p_location->>'retailer_key') || ':' || (p_location->>'scope') || ':' || (p_location->>'source_id');
  -- Keep the Kroger library's native numeric IDs when free; every other new identity uses the sequence.
  loc := null;
  if p_location->>'retailer_key' = 'kroger' and p_location->>'scope' = 'branch' and
      p_location->>'source_id' ~ '^[1-9][0-9]{0,14}$' then
    loc := (p_location->>'source_id')::numeric;
    if exists (select 1 from public.store where "locationID" = loc and location_key <> identity_key) then loc := null; end if;
  end if;
  insert into public.store("locationID", location_key, retailer_key, location_scope, source_location_id, store, "sub-location", latitude, longitude, address)
    values (coalesce(loc, nextval('public.scraper_location_ids')), identity_key, p_location->>'retailer_key', p_location->>'scope', p_location->>'source_id',
      p_location->>'name', p_location->>'label', (p_location->>'lat')::double precision,
      (p_location->>'lon')::double precision, p_location->>'address')
    on conflict (location_key) do update set
      "sub-location" = coalesce(excluded."sub-location", public.store."sub-location"),
      latitude = coalesce(excluded.latitude, public.store.latitude),
      longitude = coalesce(excluded.longitude, public.store.longitude),
      address = coalesce(excluded.address, public.store.address)
    returning "locationID" into loc;
  if (select store from public.store where "locationID" = loc) <> p_location->>'name' then
    raise exception 'The location key belongs to a different retailer';
  end if;
  for row in select value from jsonb_array_elements(p_prices) loop
    observed := (row->>'observed_at')::timestamptz;
    if length(coalesce(row->>'search_key','')) not between 1 and 400 or
      length(coalesce(row->>'category','')) not between 1 and 100 or
      length(coalesce(row->>'product_name','')) not between 1 and 300 or
      length(coalesce(row->>'source_product_id','')) not between 1 and 1000 or
      length(coalesce(row->>'package_size','')) not between 1 and 100 or
      length(coalesce(row->>'requested_unit','')) not between 1 and 100 or
      length(coalesce(row->>'price_source','')) not between 1 and 1000 or
      (row->>'price_cents')::numeric is null or
      (row->>'price_cents')::numeric not between 1 and 100000 or
      (row->>'price_cents')::numeric <> trunc((row->>'price_cents')::numeric) or
      coalesce((row->>'count')::integer,0) <= 0 or
      coalesce((row->>'unit_price')::numeric,0) <= 0 or
      observed is null or observed > now() + interval '5 minutes' or observed < now() - interval '24 hours' then
      raise exception 'Invalid, stale, or unverified price';
    end if;
    insert into public.product(category, count, price, unit_price, "locationID", date, id,
      search_key, requested_unit, product_name, source_product_id, package_size, unit_basis, source_url, price_source, observed_at)
    values (row->>'category', (row->>'count')::integer, (row->>'price_cents')::numeric / 100,
      (row->>'unit_price')::numeric, loc, (observed at time zone 'America/New_York')::date,
      (select p.id from public.products p where p.id = row->>'catalog_item_id'),
      row->>'search_key', row->>'requested_unit', row->>'product_name', row->>'source_product_id',
      row->>'package_size', row->>'unit_basis', row->>'source_url', row->>'price_source', observed)
    on conflict on constraint product_location_search_key_unique do update set
      category = excluded.category, count = excluded.count, price = excluded.price, unit_price = excluded.unit_price,
      date = excluded.date, id = excluded.id, requested_unit = excluded.requested_unit,
      product_name = excluded.product_name, source_product_id = excluded.source_product_id, package_size = excluded.package_size,
      unit_basis = excluded.unit_basis, source_url = excluded.source_url, price_source = excluded.price_source,
      observed_at = excluded.observed_at, gluten_free = null, vegan = null, nut_free = null
    where public.product.observed_at is null or excluded.observed_at > public.product.observed_at or
      (excluded.observed_at = public.product.observed_at and excluded.price < public.product.price);
    return query select loc, p."ID", p.search_key from public.product p
      where p."locationID" = loc and p.search_key = row->>'search_key';
  end loop;
end $$;

revoke all on function public.save_store_prices(jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.save_store_prices(jsonb,jsonb) to service_role;
grant usage, select on sequence public.scraper_location_ids, public.scraper_product_ids to service_role;
grant select, insert, update on public.product to service_role;
alter table public.product enable row level security;
revoke insert, update, delete, truncate, references, trigger on public.product from public, anon, authenticated;
grant select on public.product to anon, authenticated;
create policy product_scraper_read on public.product for select to anon, authenticated using (true);

-- Readable, indexed location lookup remains available through store.location_key.
create view public.store_prices with (security_invoker = true) as
  select s.location_key, s.location_scope, s.store, s."sub-location", s.address,
    p."locationID", p."ID", p.category, p.requested_unit, p.product_name, p.package_size,
    p.price, p.unit_price, p.unit_basis, p.source_url, p.price_source, p.observed_at, p.id
  from public.product p join public.store s using ("locationID");
grant select on public.store_prices to anon, authenticated, service_role;
notify pgrst, 'reload schema';
commit;
