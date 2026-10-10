from fastapi import APIRouter

from app.api.routes import catalog, health, products

api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(catalog.router, prefix="/api")
api_router.include_router(products.router, prefix="/api")
