from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

from .cli import load_knowledge_entries, review_knowledge_entries
from .config import load_settings
from .preflight import run_preflight
from .readiness import build_readiness_report
from .security import verify_waha_hmac
from .service import LeadAgentService, RetryableWebhookError, parse_json_body
from .store import Store

settings = load_settings()
store = Store(settings.database_path)
logger = logging.getLogger(__name__)


def create_app(app_settings=settings, app_store=store) -> FastAPI:
    app_service = LeadAgentService(settings=app_settings, store=app_store)

    @asynccontextmanager
    async def lifespan(app: FastAPI):  # noqa: ARG001
        stop_event = asyncio.Event()
        worker_task = None
        seed_starter_knowledge(app_settings, app_store)
        if app_settings.worker_enabled and not app_settings.frozen:
            worker_task = asyncio.create_task(app_service.run_buffer_worker(stop_event))
        try:
            yield
        finally:
            stop_event.set()
            if worker_task is not None:
                worker_task.cancel()
                with suppress(asyncio.CancelledError):
                    await worker_task

    app = FastAPI(
        title="EVO Lead Agent",
        version="0.1.0",
        lifespan=lifespan,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )

    @app.get("/health")
    async def health() -> dict[str, object]:
        return {
            "ok": True,
            "status": "live",
            "ready": False
            if app_settings.frozen or not app_settings.worker_enabled
            else build_readiness_report(
                app_settings,
                app_store.knowledge_count(),
            )["ready"]["receive_only_rollout"],
            "frozen": app_settings.frozen,
        }

    @app.post("/admin/knowledge/import")
    async def import_knowledge(request: Request) -> JSONResponse:
        if not app_settings.admin_api_key:
            return JSONResponse({"error": "admin_api_key_not_configured"}, status_code=503)
        if request.headers.get("x-evo-agent-admin-key") != app_settings.admin_api_key:
            return JSONResponse({"error": "invalid_admin_key"}, status_code=403)
        try:
            payload = await request.json()
        except Exception:
            return JSONResponse({"error": "invalid_json"}, status_code=400)

        try:
            entries = load_knowledge_entries_from_payload(payload)
        except ValueError as exc:
            return JSONResponse({"error": str(exc)}, status_code=400)
        review = review_knowledge_entries(entries)
        if not review["ok"]:
            return JSONResponse(
                {"error": "unsafe_knowledge_entries", "review": review}, status_code=422
            )
        imported = app_store.upsert_knowledge_entries(entries)
        return JSONResponse(
            {
                "ok": True,
                "imported": imported,
                "knowledge_count": app_store.knowledge_count(),
                "review": review,
            }
        )

    @app.get("/admin/readiness")
    async def readiness(request: Request) -> JSONResponse:
        if not app_settings.admin_api_key:
            return JSONResponse({"error": "admin_api_key_not_configured"}, status_code=503)
        if request.headers.get("x-evo-agent-admin-key") != app_settings.admin_api_key:
            return JSONResponse({"error": "invalid_admin_key"}, status_code=403)
        return JSONResponse(build_readiness_report(app_settings, app_store.knowledge_count()))

    @app.get("/admin/preflight")
    async def preflight(request: Request) -> JSONResponse:
        if not app_settings.admin_api_key:
            return JSONResponse({"error": "admin_api_key_not_configured"}, status_code=503)
        if request.headers.get("x-evo-agent-admin-key") != app_settings.admin_api_key:
            return JSONResponse({"error": "invalid_admin_key"}, status_code=403)
        return JSONResponse(await run_preflight(app_settings, app_store.knowledge_count()))

    @app.post("/webhooks/waha")
    async def waha_webhook(request: Request) -> JSONResponse:
        if app_settings.frozen:
            return JSONResponse({"error": "lead_agent_frozen"}, status_code=503)
        if not app_settings.waha_webhook_secret:
            return JSONResponse({"error": "waha_webhook_secret_not_configured"}, status_code=503)
        raw_body = await request.body()
        if not verify_waha_hmac(
            raw_body,
            app_settings.waha_webhook_secret,
            request.headers.get("x-webhook-hmac"),
            request.headers.get("x-webhook-hmac-algorithm"),
        ):
            return JSONResponse({"error": "invalid_signature"}, status_code=403)
        try:
            payload = parse_json_body(raw_body)
            result = await app_service.handle_waha_payload(payload)
        except RetryableWebhookError as exc:
            raise HTTPException(
                status_code=503,
                detail={"error": "webhook_processing_retryable", "reason": exc.reason},
            ) from exc
        except Exception:
            return JSONResponse({"error": "webhook_processing_failed"}, status_code=400)
        return JSONResponse(result)

    @app.post("/internal/buffers/process-due")
    async def process_due_buffers(request: Request) -> JSONResponse:
        if not app_settings.admin_api_key:
            return JSONResponse({"error": "admin_api_key_not_configured"}, status_code=503)
        if request.headers.get("x-evo-agent-admin-key") != app_settings.admin_api_key:
            return JSONResponse({"error": "invalid_admin_key"}, status_code=403)
        result = await app_service.process_due_buffers()
        return JSONResponse(result)

    return app


app = create_app()


def load_knowledge_entries_from_payload(payload: object) -> list[dict[str, object]]:
    if isinstance(payload, dict):
        raw_entries = payload.get("entries")
    else:
        raw_entries = payload
    if not isinstance(raw_entries, list):
        raise ValueError("entries_must_be_array")
    for index, entry in enumerate(raw_entries, start=1):
        if not isinstance(entry, dict):
            raise ValueError(f"entry_must_be_object:{index}")
    return raw_entries


def seed_starter_knowledge(app_settings, app_store: Store) -> int:
    starter_path = app_settings.starter_knowledge_path
    if starter_path is None or app_store.knowledge_count() > 0:
        return 0
    if not starter_path.exists():
        logger.warning("starter knowledge path does not exist: %s", starter_path)
        return 0

    try:
        entries = load_knowledge_entries(starter_path)
        review = review_knowledge_entries(entries)
    except Exception:
        logger.exception("failed to load starter knowledge")
        return 0

    if not review["ok"]:
        logger.warning(
            "starter knowledge failed safety review: total=%s unsafe=%s warnings=%s",
            review.get("total_entries"),
            review.get("unsafe_entries"),
            review.get("warning_entries"),
        )
        return 0
    return app_store.upsert_knowledge_entries(entries)
