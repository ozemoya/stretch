from typing import Any

from pydantic import BaseModel, ConfigDict


class Product(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str | int
    glutenFree: bool
    nutFree: bool


class Store(BaseModel):
    id: str
    name: str
    address: str = ""
    latitude: float | None = None
    longitude: float | None = None


class Offer(BaseModel):
    productId: str
    storeId: str
    priceCents: int
    recordedAt: str
    isSample: bool
    available: bool
    productName: str | None = None
    packageSize: str | None = None
    sourceUrl: str | None = None
    priceSource: str | None = None
    unitBasis: str | None = None
    requestedUnit: str | None = None


class CatalogResponse(BaseModel):
    products: list[Product]
    stores: list[Store]
    offers: list[Offer]
    swaps: list[dict[str, Any]]
