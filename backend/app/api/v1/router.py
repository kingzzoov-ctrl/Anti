from fastapi import APIRouter
from app.api.v1.routes_ariadne import router as ariadne_router

api_router = APIRouter()
api_router.include_router(ariadne_router, prefix='/ariadne', tags=['ariadne'])
