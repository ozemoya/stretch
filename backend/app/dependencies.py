from fastapi import Request

from app.catalog.service import CatalogService
from app.clients.supabase import SupabaseClient
from app.products.service import ProductService


def get_catalog_service(request: Request) -> CatalogService:
    supabase: SupabaseClient = request.app.state.supabase
    return CatalogService(supabase)


def get_product_service(request: Request) -> ProductService:
    supabase: SupabaseClient = request.app.state.supabase
    return ProductService(supabase)
