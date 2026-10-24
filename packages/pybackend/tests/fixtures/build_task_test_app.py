"""Isolated HTTP fixture for frontend component tests, using real feature routes."""

from fastapi import FastAPI
from build_task_routes import router

app = FastAPI()
app.include_router(router)
