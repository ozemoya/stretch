import asyncio

from app.catalog.mapper import to_catalog
from app.catalog.schemas import CatalogResponse
from app.clients.supabase import SupabaseClient


class CatalogService:
    def __init__(self, supabase: SupabaseClient) -> None:
        self.supabase = supabase

    async def get_catalog(self) -> CatalogResponse:
        products, price_rows, store_rows = await asyncio.gather(
            self.supabase.read_table("products"),
            self.supabase.read_table("product"),
            self.supabase.read_table("store"),
        )
        return CatalogResponse.model_validate(
            to_catalog(products, price_rows, store_rows)
        )
