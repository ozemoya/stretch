from app.clients.supabase import SupabaseClient
from app.products.schemas import ProductOption


class ProductService:
    def __init__(self, supabase: SupabaseClient) -> None:
        self.supabase = supabase

    async def find_options(
        self,
        *,
        category: str | None,
        location_id: str | None,
        product_id: str | None,
        gluten_free: bool | None,
        vegan: bool | None,
        nut_free: bool | None,
        limit: int,
        offset: int,
        order: str,
    ) -> list[ProductOption]:
        filters = {
            key: f"eq.{str(value).lower() if isinstance(value, bool) else value}"
            for key, value in (
                ("category", category),
                ("location_key", location_id),
                ("id", product_id),
                ("gluten_free", gluten_free),
                ("vegan", vegan),
                ("nut_free", nut_free),
            )
            if value is not None
        }
        rows = await self.supabase.read_table(
            "product",
            filters=filters,
            limit=limit,
            offset=offset,
            order=order,
        )
        return [ProductOption.model_validate(row) for row in rows]
