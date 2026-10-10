import asyncio
import os
from pathlib import Path
from decimal import Decimal, InvalidOperation
from datetime import date
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv


load_dotenv(Path(__file__).with_name(".env"))

app = FastAPI(title="Stretch API", version="1.0.0")


def _allowed_origins() -> list[str]:
    configured = os.getenv("FRONTEND_ORIGINS", "http://localhost:3000")
    return [origin.strip() for origin in configured.split(",") if origin.strip()]


app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins(),
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=["*"],
)


def _supabase_headers() -> dict[str, str]:
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv(
        "SUPABASE_PUBLISHABLE_KEY"
    )
    if not key:
        raise HTTPException(
            status_code=503,
            detail="Supabase credentials are not configured.",
        )
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
    }


def _supabase_url() -> str:
    url = os.getenv("SUPABASE_URL")
    if not url:
        raise HTTPException(
            status_code=503,
            detail="SUPABASE_URL is not configured.",
        )
    return url.rstrip("/")


async def _read_table(client: httpx.AsyncClient, table: str) -> list[dict[str, Any]]:
    response = await client.get(
        f"{_supabase_url()}/rest/v1/{table}",
        headers=_supabase_headers(),
        params={"select": "*"},
    )
    if response.is_error:
        raise HTTPException(
            status_code=502,
            detail=f"Supabase could not load {table}.",
        )
    data = response.json()
    if not isinstance(data, list):
        raise HTTPException(
            status_code=502,
            detail=f"Supabase returned an invalid response for {table}.",
        )
    return data


def _to_catalog(
    products: list[dict[str, Any]],
    price_rows: list[dict[str, Any]],
    store_rows: list[dict[str, Any]],
) -> dict[str, list[dict[str, Any]]]:
    stores = [
        {
            "id": str(store["locationID"]),
            "name": " - ".join(
                part
                for part in (store["store"], store.get("sub-location"))
                if part
            ),
        }
        for store in store_rows
    ]
    valid_store_ids = {store["id"] for store in stores}
    offers = []
    for row in price_rows:
        product_id = row.get("id")
        location_id = row.get("locationID")
        if not product_id or location_id is None:
            continue
        store_id = str(location_id)
        if store_id not in valid_store_ids:
            continue
        try:
            price_cents = int(
                (Decimal(str(row["price"])) * Decimal("100")).quantize(Decimal("1"))
            )
        except (InvalidOperation, TypeError, ValueError):
            continue
        if price_cents < 0:
            continue
        recorded_at = row.get("date")
        if isinstance(recorded_at, date):
            recorded_at = recorded_at.isoformat()
        offers.append(
            {
                "productId": str(product_id),
                "storeId": store_id,
                "priceCents": price_cents,
                "recordedAt": (
                    f"{recorded_at}T00:00:00Z"
                    if recorded_at
                    else "1970-01-01T00:00:00Z"
                ),
                "isSample": False,
                "available": True,
            }
        )
    return {
        "products": [
            {
                **product,
                "glutenFree": product["gluten_free"],
                "nutFree": product["nut_free"],
            }
            for product in products
        ],
        "stores": stores,
        "offers": offers,
        "swaps": [],
    }


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/catalog")
async def catalog() -> dict[str, list[dict[str, Any]]]:
    async with httpx.AsyncClient(
        timeout=httpx.Timeout(8.0, connect=3.0),
    ) as client:
        try:
            products, price_rows, store_rows = await asyncio.gather(
                *(
                    _read_table(client, table)
                    for table in ("products", "product", "store")
                )
            )
        except HTTPException:
            raise
        except (httpx.HTTPError, ValueError) as error:
            raise HTTPException(
                status_code=502,
                detail="Supabase could not be reached.",
            ) from error
    return _to_catalog(products, price_rows, store_rows)