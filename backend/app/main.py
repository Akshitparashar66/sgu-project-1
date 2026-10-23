import os

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware

from app.api.errors import (
    AegisError, aegis_error_handler, request_validation_error_handler, unhandled_error_handler,
)
from app.api.routes import router

app = FastAPI(title="AEGIS", version="0.1.0-mvp")

# The Next.js dev origin, plus any deployed demo origins listed
# comma-separated in AEGIS_CORS_ORIGINS (set it before going on stage).
_extra_origins = [o.strip() for o in os.environ.get("AEGIS_CORS_ORIGINS", "").split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000", *_extra_origins],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_exception_handler(AegisError, aegis_error_handler)
app.add_exception_handler(RequestValidationError, request_validation_error_handler)
app.add_exception_handler(Exception, unhandled_error_handler)
app.include_router(router)
