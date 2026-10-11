from fastapi import APIRouter, Depends, HTTPException

from app.catalog.schemas import CatalogResponse
from app.catalog.service import CatalogService
from app.dependencies import get_catalog_service
from app.clients.supabase import (
    SupabaseConfigurationError,
    SupabaseRequestError,
)

router = APIRouter(prefix="/catalog", tags=["catalog"])


@router.get("", response_model=CatalogResponse)
async def get_catalog(
    service: CatalogService = Depends(get_catalog_service),
) -> CatalogResponse:
    try:
        return await service.get_catalog()
    except SupabaseConfigurationError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except SupabaseRequestError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
