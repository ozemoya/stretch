from typing import Any

import httpx

from app.core.config import Settings


class SupabaseConfigurationError(Exception):
    """Raised when required Supabase configuration is missing."""


class SupabaseRequestError(Exception):
    """Raised when Supabase returns an unusable response."""


class SupabaseClient:
    def __init__(self, client: httpx.AsyncClient, settings: Settings) -> None:
        self.client = client
        self.settings = settings

    async def read_table(
        self,
        table: str,
        *,
        filters: dict[str, str] | None = None,
        limit: int | None = None,
        offset: int | None = None,
        order: str | None = None,
    ) -> list[dict[str, Any]]:
        url = self.settings.supabase_url
        key = self.settings.supabase_key
        if not url or not key:
            raise SupabaseConfigurationError(
                "Supabase credentials are not configured."
            )

        try:
            response = await self.client.get(
                f"{url.rstrip('/')}/rest/v1/{table}",
                headers={
                    "apikey": key,
                    "Authorization": f"Bearer {key}",
                },
                params={
                    "select": "*",
                    **(filters or {}),
                    **({"limit": str(limit)} if limit is not None else {}),
                    **({"offset": str(offset)} if offset is not None else {}),
                    **({"order": order} if order else {}),
                },
            )
            response.raise_for_status()
            data = response.json()
        except (httpx.HTTPError, ValueError) as error:
            raise SupabaseRequestError(
                f"Supabase could not load {table}."
            ) from error

        if not isinstance(data, list):
            raise SupabaseRequestError(
                f"Supabase returned an invalid response for {table}."
            )
        return data
