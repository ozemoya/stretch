import unittest

from app.catalog.mapper import to_catalog


class CatalogMapperTests(unittest.TestCase):
    def test_uses_branch_location_keys_and_excludes_catalog_scope(self):
        products = [{"id": "eggs", "gluten_free": True, "nut_free": True}]
        stores = [
            {"location_key": "kroger:branch:123", "store": "Kroger", "location_scope": "branch"},
            {"location_key": "kroger:catalog:30303", "store": "Kroger", "location_scope": "catalog"},
        ]
        prices = [
            {"id": "eggs", "location_key": "kroger:branch:123", "price": "2.49", "observed_at": "2026-10-10T12:00:00Z"},
            {"id": "eggs", "location_key": "kroger:catalog:30303", "price": "1.99", "observed_at": "2026-10-10T12:00:00Z"},
        ]

        catalog = to_catalog(products, prices, stores)

        self.assertEqual(catalog["stores"], [{"id": "kroger:branch:123", "name": "Kroger"}])
        self.assertEqual(catalog["offers"], [{
            "productId": "eggs", "storeId": "kroger:branch:123", "priceCents": 249,
            "recordedAt": "2026-10-10T12:00:00Z", "isSample": False, "available": True,
        }])


if __name__ == "__main__":
    unittest.main()
