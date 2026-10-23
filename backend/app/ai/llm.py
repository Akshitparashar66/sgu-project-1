"""The one place AEGIS talks to an LLM (Google Gemini). Both AI features (run
briefings and typed what-if questions) go through here, and both work without
it: when no key is configured, or every model fails, callers fall back to
their deterministic offline path and say so in `source`."""
from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import TypeVar

import httpx
from dotenv import load_dotenv
from google import genai
from google.genai import errors, types
from pydantic import BaseModel

logger = logging.getLogger("aegis.ai")

# backend/.env.local (git-ignored) holds GEMINI_API_KEY for local runs; a real
# environment variable of the same name takes precedence.
load_dotenv(Path(__file__).resolve().parents[2] / ".env.local", override=False)

PROVIDER = "Google Gemini"
# Tried in order: if a model is overloaded, timing out or retired, the next
# one answers instead. Override with a comma-separated AEGIS_AI_MODEL.
MODELS = [m.strip() for m in os.environ.get(
    "AEGIS_AI_MODEL", "gemini-3.5-flash,gemini-3.6-flash,gemini-3.5-flash-lite").split(",") if m.strip()]
MODEL = MODELS[0]
# Per attempt. A demo should never hang on the network: fail fast, then fall back.
TIMEOUT_MS = 25_000

_client: genai.Client | None = None

T = TypeVar("T", bound=BaseModel)


class AIUnavailable(Exception):
    """The LLM could not produce a usable answer. The message is safe to show
    in the UI; callers catch this and switch to their offline path."""


def ai_configured() -> bool:
    if os.environ.get("AEGIS_AI_DISABLED", "").lower() in {"1", "true", "yes"}:
        return False
    return bool(os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY"))


def get_client() -> genai.Client | None:
    """None when AI is not configured. Tests monkeypatch this."""
    global _client
    if not ai_configured():
        return None
    if _client is None:
        _client = genai.Client(http_options=types.HttpOptions(
            timeout=TIMEOUT_MS, retry_options=types.HttpRetryOptions(attempts=1),
        ))
    return _client


def _generate(system: str, user: str, config: dict):
    client = get_client()
    if client is None:
        raise AIUnavailable("AI is not configured (set GEMINI_API_KEY on the backend).")
    last_problem = "no model answered"
    for model in MODELS:
        try:
            response = client.models.generate_content(
                model=model, contents=user,
                config=types.GenerateContentConfig(system_instruction=system, **config),
            )
        except errors.ClientError as exc:
            if exc.code in (401, 403) or (exc.code == 400 and "API key" in str(exc)):
                raise AIUnavailable("The backend's Gemini API key was rejected.") from exc
            if exc.code == 429:
                raise AIUnavailable("The Gemini API quota is used up for now; try again shortly.") from exc
            last_problem = f"{model}: {exc.code}"  # e.g. 404, model retired: try the next one
            logger.warning("Gemini %s client error %s: %s", model, exc.code, exc.message)
            continue
        except (errors.ServerError, httpx.HTTPError) as exc:
            last_problem = f"{model}: {getattr(exc, 'code', type(exc).__name__)}"  # overloaded / timed out
            logger.warning("Gemini %s unavailable: %s", model, exc)
            continue

        if response.prompt_feedback and response.prompt_feedback.block_reason:
            raise AIUnavailable("Gemini declined this request.")
        candidate = (response.candidates or [None])[0]
        reason = getattr(candidate, "finish_reason", None)
        if reason == types.FinishReason.MAX_TOKENS:
            raise AIUnavailable("Gemini's answer was cut off.")
        if reason not in (None, types.FinishReason.STOP):
            raise AIUnavailable(f"Gemini stopped early ({reason}).")
        return response
    raise AIUnavailable(f"Gemini is unavailable right now ({last_problem}).")


def complete_text(system: str, user: str) -> str:
    text = (_generate(system, user, {}).text or "").strip()
    if not text:
        raise AIUnavailable("Gemini returned an empty answer.")
    return text


def complete_structured(system: str, user: str, output_format: type[T]) -> T:
    response = _generate(system, user, {"response_mime_type": "application/json", "response_schema": output_format})
    parsed = response.parsed
    if isinstance(parsed, output_format):
        return parsed
    try:
        return output_format.model_validate_json(response.text or "")
    except ValueError as exc:
        raise AIUnavailable("Gemini's answer did not match the expected format.") from exc
