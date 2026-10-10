-- Keep unknown historical update dates null so those prices refresh on next search.
begin;
alter table public.product add column date date;
comment on column public.product.date is
  'Last price retrieval day in America/New_York; null means not yet dated.';
notify pgrst, 'reload schema';
commit;
