-- Promote the readable location identity and migrate every dependent store reference.
begin;
lock table public.store, public.product in access exclusive mode;

create temporary table migrated_store_references (table_id oid primary key, alias_column text) on commit drop;

-- Capture existing numeric relationships before removing their constraints. Refuse
-- ambiguous composite/multiple relationships instead of guessing which branch they mean.
do $$
declare ref record; conflicting boolean;
begin
  for ref in
    select c.conrelid, c.conname, c.conkey, c.confkey, a.attname as target_column,
      (select attname from pg_attribute where attrelid=c.conrelid and attnum=c.conkey[1]) as source_column
    from pg_constraint c join pg_attribute a on a.attrelid=c.confrelid and a.attnum=c.confkey[1]
    where c.contype='f' and c.confrelid='public.store'::regclass
  loop
    if array_length(ref.conkey,1) <> 1 or array_length(ref.confkey,1) <> 1 or
      ref.target_column not in ('locationID','location_key') then
      raise exception 'Unsupported store relationship: %', ref.conname;
    end if;
    if ref.target_column='locationID' then
      insert into migrated_store_references values (ref.conrelid, ref.source_column);
      execute format('alter table %s add column if not exists location_key text', ref.conrelid::regclass);
      execute format('update %s r set location_key=s.location_key from public.store s where r.%I=s."locationID" and r.location_key is null',
        ref.conrelid::regclass, ref.source_column);
      execute format('select exists(select 1 from %s r join public.store s on r.%I=s."locationID" where r.location_key<>s.location_key)',
        ref.conrelid::regclass, ref.source_column) into conflicting;
      if conflicting then raise exception 'Conflicting numeric and readable location identities'; end if;
    elsif ref.source_column <> 'location_key' then
      raise exception 'Readable store references must use location_key: %', ref.conname;
    end if;
    execute format('alter table %s drop constraint %I', ref.conrelid::regclass, ref.conname);
  end loop;
end $$;

-- Numeric IDs remain unique compatibility aliases, never foreign-key targets.
alter table public.store add constraint store_location_id_unique unique ("locationID");
do $$
declare primary_name text;
begin
  select conname into strict primary_name from pg_constraint where conrelid='public.store'::regclass and contype='p';
  execute format('alter table public.store drop constraint %I', primary_name);
end $$;
alter table public.store drop constraint store_location_key_unique;
alter table public.store add constraint store_pkey primary key (location_key);

-- Every location_key in a public table now references the store primary key.
-- PostgreSQL validates existing rows; any orphan aborts this entire migration.
do $$
declare target record;
begin
  for target in
    select c.oid from pg_class c join pg_namespace n on n.oid=c.relnamespace
      join pg_attribute a on a.attrelid=c.oid
    where n.nspname='public' and c.relkind in ('r','p') and a.attname='location_key'
      and not a.attisdropped and c.oid<>'public.store'::regclass
  loop
    execute format('alter table %s add constraint location_key_store_fk foreign key (location_key) references public.store(location_key) on update cascade on delete restrict', target.oid::regclass);
    execute format('create index on %s (location_key)', target.oid::regclass);
  end loop;
end $$;

-- Compatibility writes still resolve through the canonical foreign key. An
-- explicitly supplied key/alias mismatch is rejected, including on updates.
create function public.resolve_store_reference() returns trigger
language plpgsql set search_path=public as $$
declare payload jsonb := to_jsonb(new); prior jsonb; key text; alias_id numeric; actual_id numeric;
begin
  key := payload->>'location_key';
  alias_id := (payload->>tg_argv[0])::numeric;
  if tg_op='UPDATE' then
    prior := to_jsonb(old);
    if key is distinct from prior->>'location_key' and alias_id is not distinct from (prior->>tg_argv[0])::numeric then
      alias_id := null;
    elsif alias_id is distinct from (prior->>tg_argv[0])::numeric and key is not distinct from prior->>'location_key' then
      key := null;
    end if;
  end if;
  if key is null and alias_id is not null then
    select s.location_key into key from public.store s where s."locationID"=alias_id;
    if key is null then raise exception 'Unknown numeric store alias'; end if;
  end if;
  if key is not null then
    select s."locationID" into actual_id from public.store s where s.location_key=key;
    if actual_id is null then raise exception 'Unknown store location_key'; end if;
    if alias_id is not null and alias_id<>actual_id then raise exception 'Conflicting store location references'; end if;
    alias_id := actual_id;
  end if;
  new := jsonb_populate_record(new, jsonb_build_object('location_key',key,tg_argv[0],alias_id));
  return new;
end $$;
do $$
declare target record;
begin
  for target in select * from migrated_store_references loop
    execute format('create trigger store_location_reference_guard before insert or update on %s for each row execute function public.resolve_store_reference(%L)',
      target.table_id::regclass, target.alias_column);
    if exists(select 1 from pg_attribute where attrelid=target.table_id and attname=target.alias_column and attnotnull) then
      execute format('alter table %s alter column location_key set not null', target.table_id::regclass);
    end if;
  end loop;
end $$;

alter table public.product drop constraint product_location_search_key_unique;
alter table public.product add constraint product_location_search_key_unique unique (location_key,search_key);

-- The writer and view below use the new primary key; numeric aliases remain in
-- the RPC result and read view for backwards-compatible callers.
create or replace function public.save_store_prices(p_location jsonb, p_prices jsonb)
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
  if (select store from public.store where location_key = identity_key) <> p_location->>'name' then
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
    insert into public.product(category, count, price, unit_price, location_key, date, id,
      search_key, requested_unit, product_name, source_product_id, package_size, unit_basis, source_url, price_source, observed_at)
    values (row->>'category', (row->>'count')::integer, (row->>'price_cents')::numeric / 100,
      (row->>'unit_price')::numeric, identity_key, (observed at time zone 'America/New_York')::date,
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
      where p.location_key = identity_key and p.search_key = row->>'search_key';
  end loop;
end $$;

create or replace view public.store_prices with (security_invoker = true) as
  select s.location_key, s.location_scope, s.store, s."sub-location", s.address,
    p."locationID", p."ID", p.category, p.requested_unit, p.product_name, p.package_size,
    p.price, p.unit_price, p.unit_basis, p.source_url, p.price_source, p.observed_at, p.id
  from public.product p join public.store s on s.location_key=p.location_key;
grant select on public.store_prices to anon, authenticated, service_role;
notify pgrst, 'reload schema';
commit;

