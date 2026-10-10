from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query

from app.clients.supabase import (
    SupabaseConfigurationError,
    SupabaseRequestError,
)
from app.dependencies import get_product_service
from app.products.schemas import ProductOption
from app.products.service import ProductService

router = APIRouter(prefix="/products", tags=["products"])

Order = Annotated[
    str,
    Query(
        pattern=r"^(category|date|price|unit_price|locationID|ID)\.(asc|desc)$",
        description="Sort field and direction, for example price.asc.",
    ),
]


@router.get("", response_model=list[ProductOption])
async def find_products(
    service: ProductService = Depends(get_product_service),
    category: str | None = Query(default=None, min_length=1),
    location_id: str | None = Query(
        default=None,
        alias="locationID",
        min_length=1,
        description="Return options from one store location.",
    ),
    product_id: str | None = Query(
        default=None,
        alias="id",
        min_length=1,
        description="Return options for one product.",
    ),
    gluten_free: bool | None = None,
    vegan: bool | None = None,
    nut_free: bool | None = None,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    order: Order = "category.asc",
) -> list[ProductOption]:
    try:
        return await service.find_options(
            category=category,
            location_id=location_id,
            product_id=product_id,
            gluten_free=gluten_free,
            vegan=vegan,
            nut_free=nut_free,
            limit=limit,
            offset=offset,
            order=order,
        )
    except SupabaseConfigurationError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except (SupabaseRequestError, ValueError) as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
