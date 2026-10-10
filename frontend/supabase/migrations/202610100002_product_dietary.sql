-- Preserve unknown attributes on historical prices; do not copy sample catalog tags.
begin;
alter table public.product
  add column gluten_free boolean,
  add column vegan boolean,
  add column nut_free boolean;
comment on column public.product.gluten_free is 'Explicit gluten-free product-name claim; null means unknown.';
comment on column public.product.vegan is 'Explicit vegan product-name claim; null means unknown.';
comment on column public.product.nut_free is 'Explicit nut-free product-name claim; null means unknown. Peanut-free or tree-nut-free alone is insufficient.';
notify pgrst, 'reload schema';
commit;
