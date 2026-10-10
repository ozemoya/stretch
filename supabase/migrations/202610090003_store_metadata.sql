-- Extend live store records; existing product links and access policies stay intact.
begin;
alter table public.store
  add column latitude double precision check (latitude between -90 and 90),
  add column longitude double precision check (longitude between -180 and 180),
  add column address text,
  add constraint store_coordinates_pair check ((latitude is null) = (longitude is null));
notify pgrst, 'reload schema';
commit;
