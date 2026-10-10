from fastapi import Request

from app.catalog.service import CatalogService
from app.clients.supabase import SupabaseClient


def get_catalog_service(request: Request) -> CatalogService:
    supabase: SupabaseClient = request.app.state.supabase
    return CatalogService(supabase)
