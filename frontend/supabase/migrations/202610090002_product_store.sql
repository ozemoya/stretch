-- Normalize the live Kroger product table; the sample catalog uses stores/products.
begin;

lock table public.product in access exclusive mode;

-- Refuse to lose names or silently choose between conflicting store identities.
do $$
begin
  if exists (
    select 1 from public.product
    where "locationID" is null and (store is not null or "sub-location" is not null)
  ) then
    raise exception 'Product store names without locationID must be resolved first';
  end if;
  if exists (
    select 1 from public.product
    where "locationID" is not null and (store is null or btrim(store) = '')
  ) then
    raise exception 'Every product locationID must have a store brand';
  end if;
  if exists (
    select "locationID" from (
      select distinct "locationID", store, "sub-location"
      from public.product where "locationID" is not null
    ) identities
    group by "locationID" having count(*) > 1
  ) then
    raise exception 'Conflicting store names for one locationID must be resolved first';
  end if;
end $$;

create table public.store (
  "locationID" numeric primary key,
  store text not null check (btrim(store) <> ''),
  "sub-location" text
);

insert into public.store ("locationID", store, "sub-location")
select distinct "locationID", store, "sub-location"
from public.product where "locationID" is not null;

alter table public.product
  add constraint product_location_store_fk foreign key ("locationID")
  references public.store ("locationID") on update cascade on delete restrict;
create index product_location_id_idx on public.product ("locationID");

-- Store names follow the catalog's public-read/server-write access pattern.
alter table public.store enable row level security;
revoke all on public.store from public, anon, authenticated;
grant select on public.store to anon, authenticated;
grant all on public.store to service_role;
create policy store_read on public.store for select to anon, authenticated using (true);

-- The validated copies and foreign key now preserve each product's store identity.
alter table public.product drop column store, drop column "sub-location";
notify pgrst, 'reload schema';
commit;
