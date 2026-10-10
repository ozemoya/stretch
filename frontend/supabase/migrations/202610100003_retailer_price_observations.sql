-- Evidence ledger for website/catalog observations. Apply separately from the sample catalog.
begin;

create table if not exists public.retailer_integration (
  retailer_id text primary key,
  display_name text not null,
  source_kind text not null check (source_kind in ('official_api', 'retailer_website', 'licensed_provider')),
  status text not null check (status in ('available', 'limited', 'unavailable', 'blocked')),
  checked_at timestamptz not null default now(),
  detail text not null default ''
);

create table if not exists public.retailer_location (
  retailer_id text not null references public.retailer_integration(retailer_id),
  location_id text not null,
  source_store_id text,
  store_name text not null,
  address text not null,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  primary key (retailer_id, location_id)
);

create table if not exists public.retailer_listing (
  retailer_id text not null references public.retailer_integration(retailer_id),
  product_id text not null,
  product_name text not null,
  brand text,
  package_size text,
  product_url text not null check (product_url ~ '^https://'),
  image_url text check (image_url is null or image_url ~ '^https://'),
  image_source_url text check (image_source_url is null or image_source_url ~ '^https://'),
  image_source text,
  image_type text check (image_type is null or image_type in ('retailer', 'manufacturer', 'licensed_reference', 'generic_illustration')),
  image_license text,
  image_attribution text,
  image_match_confidence double precision check (image_match_confidence is null or image_match_confidence between 0 and 1),
  image_verified_at timestamptz,
  image_usage_note text not null default 'Source-hosted display only; rights not established for caching or redistribution',
  primary key (retailer_id, product_id)
);

create table if not exists public.product_image_reference (
  lookup_key text primary key,
  product_name text not null,
  brand text,
  package_size text,
  upc text,
  image_url text check (image_url is null or image_url ~ '^https://'),
  image_source text not null,
  image_source_url text check (image_source_url is null or image_source_url ~ '^https://'),
  image_type text not null check (image_type in ('retailer', 'manufacturer', 'licensed_reference', 'generic_illustration')),
  image_license text,
  image_attribution text,
  image_match_confidence double precision not null check (image_match_confidence between 0 and 1),
  image_verified_at timestamptz not null,
  expires_at timestamptz not null
);

create table if not exists public.retailer_price_observation (
  id uuid primary key default gen_random_uuid(),
  retailer_id text not null,
  product_id text not null,
  location_id text,
  source_store_id text,
  price_cents integer not null check (price_cents > 0),
  price_basis text not null check (price_basis in ('package', 'each', 'per_lb')),
  price_kind text not null check (price_kind in ('online_catalog', 'branch_advertised', 'branch_catalog')),
  fulfillment_method text not null check (fulfillment_method in ('unknown', 'in_store', 'pickup', 'delivery')),
  availability text not null check (availability in ('unknown', 'available', 'unavailable')),
  source_url text not null check (source_url ~ '^https://'),
  observed_at timestamptz not null,
  valid_until timestamptz,
  created_at timestamptz not null default now(),
  foreign key (retailer_id, product_id) references public.retailer_listing(retailer_id, product_id),
  foreign key (retailer_id, location_id) references public.retailer_location(retailer_id, location_id),
  check (location_id is not null or price_kind = 'online_catalog'),
  check (valid_until is null or valid_until > observed_at)
);
create index if not exists retailer_price_lookup_idx on public.retailer_price_observation
  (retailer_id, location_id, product_id, observed_at desc);

create table if not exists public.retailer_search_job (
  id uuid primary key default gen_random_uuid(),
  retailer_id text not null references public.retailer_integration(retailer_id),
  request_id text not null,
  query_text text not null,
  location_id text,
  status text not null check (status in ('queued', 'searching', 'completed', 'no_results', 'timeout', 'error', 'unavailable')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  error_code text,
  foreign key (retailer_id, location_id) references public.retailer_location(retailer_id, location_id)
);

-- The app does not write these tables until a server-only role is configured.
alter table public.retailer_integration enable row level security;
alter table public.retailer_location enable row level security;
alter table public.retailer_listing enable row level security;
alter table public.retailer_price_observation enable row level security;
alter table public.retailer_search_job enable row level security;
alter table public.product_image_reference enable row level security;
revoke all on public.retailer_integration, public.retailer_location, public.retailer_listing,
  public.retailer_price_observation, public.retailer_search_job, public.product_image_reference from public, anon, authenticated;
grant all on public.retailer_integration, public.retailer_location, public.retailer_listing,
  public.retailer_price_observation, public.retailer_search_job, public.product_image_reference to service_role;

notify pgrst, 'reload schema';
commit;
