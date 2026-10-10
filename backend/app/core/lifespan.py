from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI

from app.clients.supabase import SupabaseClient
from app.core.config import get_settings


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    http_client = httpx.AsyncClient(
        timeout=httpx.Timeout(8.0, connect=3.0),
    )
    app.state.supabase = SupabaseClient(http_client, settings)

    try:
        yield
    finally:
        await http_client.aclose()
