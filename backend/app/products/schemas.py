from datetime import date as date_type
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


class ProductOption(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    category: str
    count: int | None = None
    price: Decimal
    unit_price: Decimal | None = None
    location_key: str | None = None
    record_id: Decimal = Field(alias="ID")
    date: date_type | None = None
    id: str | None = None
    gluten_free: bool | None = None
    vegan: bool | None = None
    nut_free: bool | None = None
