from __future__ import annotations

import logging

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

logger = logging.getLogger("aegis")

# Location prefixes FastAPI puts in front of the field path ("body",
# "scenarioId") — dropped so `field` names the actual input field.
_LOCATION_PREFIXES = {"body", "query", "path", "header", "cookie"}


class AegisError(Exception):
    """Every endpoint raises this instead of a bare HTTPException so every
    error on the wire has the same {errorCode, message, field} shape
    (PRD §10.8)."""

    def __init__(self, code: str, message: str, field: str | None = None, status_code: int = 400,
                 errors: list[dict] | None = None):
        self.code = code
        self.message = message
        self.field = field
        self.status_code = status_code
        self.errors = errors
        super().__init__(message)


def _content(code: str, message: str, field: str | None, errors: list[dict] | None = None) -> dict:
    content: dict = {"errorCode": code, "message": message, "field": field}
    if errors is not None:
        content["errors"] = errors
    return content


async def aegis_error_handler(request: Request, exc: AegisError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content=_content(exc.code, exc.message, exc.field, exc.errors),
    )


def validation_errors_to_fields(raw_errors) -> list[dict]:
    """Pydantic/FastAPI error list -> [{field, message}], the actionable
    shape the frontend shows next to the offending input."""
    fields = []
    for error in raw_errors:
        loc = [str(part) for part in error.get("loc", ()) if part not in _LOCATION_PREFIXES]
        fields.append({"field": ".".join(loc) or None, "message": error.get("msg", "Invalid value")})
    return fields


async def request_validation_error_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    errors = validation_errors_to_fields(exc.errors())
    first = errors[0] if errors else {"field": None, "message": "Invalid request"}
    message = f"Invalid request: {first['field']} — {first['message']}" if first["field"] else first["message"]
    return JSONResponse(status_code=422, content=_content("VALIDATION_ERROR", message, first["field"], errors))


async def unhandled_error_handler(request: Request, exc: Exception) -> JSONResponse:
    # Full detail goes to the server log only; the client gets a stable
    # code and a generic message, never a stack trace or internals.
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content=_content("INTERNAL_ERROR", "The server hit an unexpected error. Check the backend log.", None),
    )
