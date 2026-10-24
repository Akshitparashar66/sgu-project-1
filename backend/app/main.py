import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware

from app.api.errors import (
    AegisError, aegis_error_handler, request_validation_error_handler, unhandled_error_handler,
)
from app.api.live_routes import router as live_router
from app.api.routes import router
from app.live.config import live_enabled
from app.live.poller import Poller

ENV_FILE = Path(__file__).resolve().parents[1] / ".env.local"  # git-ignored: API keys


def load_env_file(path: Path = ENV_FILE) -> None:
    """KEY=value lines from backend/.env.local, without overriding anything
    already set in the environment (Docker, CI, the shell)."""
    if os.environ.get("AEGIS_NO_ENV_FILE") == "1" or not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        key, sep, value = line.partition("=")
        if sep and key.strip() and not key.lstrip().startswith("#"):
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


@asynccontextmanager
async def lifespan(_: FastAPI):
    load_env_file()
    poller = Poller() if live_enabled() else None
    if poller:
        poller.start()
    yield
    if poller:
        poller.stop()


app = FastAPI(title="AEGIS", version="0.1.0-mvp", lifespan=lifespan)

# The Next.js dev origin, plus any deployed demo origins listed
# comma-separated in AEGIS_CORS_ORIGINS (set it before going on stage).
_extra_origins = [o.strip() for o in os.environ.get("AEGIS_CORS_ORIGINS", "").split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000", *_extra_origins],
    # e.g. https://aegis-[a-z0-9-]+\.vercel\.app for a host's preview deployments.
    allow_origin_regex=os.environ.get("AEGIS_CORS_ORIGIN_REGEX") or None,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_exception_handler(AegisError, aegis_error_handler)
app.add_exception_handler(RequestValidationError, request_validation_error_handler)
app.add_exception_handler(Exception, unhandled_error_handler)
app.include_router(router)
app.include_router(live_router)
