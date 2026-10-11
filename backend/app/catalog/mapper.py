from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Any


def to_catalog(
    products: list[dict[str, Any]],
    price_rows: list[dict[str, Any]],
    store_rows: list[dict[str, Any]],
) -> dict[str, list[dict[str, Any]]]:
    stores = [
        {
            "id": str(store["location_key"]),
            "name": " - ".join(
                part
                for part in (store["store"], store.get("sub-location"))
                if part
            ),
        }
        for store in store_rows
        if store.get("location_scope", "branch") == "branch"
    ]
    valid_store_ids = {store["id"] for store in stores}
    offers = []
    for row in price_rows:
        product_id = row.get("id")
        location_id = row.get("location_key")
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
        recorded_at = row.get("observed_at") or row.get("date")
        if isinstance(recorded_at, date):
            recorded_at = recorded_at.isoformat()
        offers.append(
            {
                "productId": str(product_id),
                "storeId": store_id,
                "priceCents": price_cents,
                "recordedAt": (
                    (recorded_at if "T" in recorded_at else f"{recorded_at}T00:00:00Z")
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
