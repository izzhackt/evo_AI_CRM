from __future__ import annotations

import json
from typing import Any

import httpx

from .config import Settings
from .readiness import build_readiness_report
from .waha import WahaClient


async def run_preflight(settings: Settings, knowledge_count: int | None = None) -> dict[str, Any]:
    readiness = build_readiness_report(settings, knowledge_count)
    checks = {
        "admin_configuration": _check_admin(settings),
        "waha_session": await _check_waha(settings),
        "amo_account": await _check_amo(settings),
        "crm_sync_signing": _check_crm_sync(settings),
        "gemini_configuration": _check_gemini(settings),
    }
    ok = (
        all(check["status"] == "passed" for check in checks.values())
        and readiness["ready"]["receive_only_rollout"]
    )
    return {
        "ok": ok,
        "readiness": readiness,
        "checks": checks,
    }


async def _check_waha(settings: Settings) -> dict[str, Any]:
    missing = []
    if not settings.waha_base_url:
        missing.append("EVO_AGENT_WAHA_BASE_URL")
    if not settings.waha_api_key:
        missing.append("EVO_AGENT_WAHA_API_KEY")
    if not settings.waha_session_name:
        missing.append("EVO_AGENT_WAHA_SESSION")
    if missing:
        return {"status": "skipped", "reason": "missing_config", "missing": missing}

    try:
        session = await WahaClient(
            base_url=settings.waha_base_url or "",
            api_key=settings.waha_api_key or "",
            session_name=settings.waha_session_name,
        ).session_info()
    except Exception as exc:
        return _failed(exc)
    public_session = _public_waha_session(session, settings.waha_session_name)
    if public_session["found"] is False:
        return {"status": "failed", "reason": "session_not_found", "session": settings.waha_session_name}
    if not _waha_session_is_working(public_session.get("status")):
        return {
            "status": "failed",
            "reason": "session_not_working",
            "session": public_session,
        }
    return {"status": "passed", "session": public_session}


def _check_admin(settings: Settings) -> dict[str, Any]:
    if not settings.admin_api_key:
        return {
            "status": "skipped",
            "reason": "missing_config",
            "missing": ["EVO_AGENT_ADMIN_API_KEY"],
        }
    return {"status": "passed", "private_admin_api": "configured"}


async def _check_amo(settings: Settings) -> dict[str, Any]:
    missing = _missing_amo_settings(settings)
    if missing:
        return {"status": "skipped", "reason": "missing_config", "missing": missing}

    access_token = _read_access_token(settings)
    if not access_token:
        return {
            "status": "skipped",
            "reason": "non_destructive_access_token_missing",
            "missing": ["EVO_AGENT_AMO_TOKEN_FILE with access_token"],
        }

    try:
        account = await _amo_account_info(settings, access_token)
    except Exception as exc:
        return _failed(exc)
    return {"status": "passed", "account": _public_amo_account(account)}


def _check_crm_sync(settings: Settings) -> dict[str, Any]:
    missing = []
    if not settings.crm_base_url:
        missing.append("EVO_AGENT_CRM_BASE_URL")
    if not settings.crm_sync_secret:
        missing.append("EVO_AGENT_CRM_SYNC_SECRET")
    if missing:
        return {"status": "skipped", "reason": "missing_config", "missing": missing}
    return {
        "status": "passed",
        "base_url_configured": True,
        "signature_algorithm": "sha256",
    }


def _check_gemini(settings: Settings) -> dict[str, Any]:
    if not settings.gemini_configured:
        return {
            "status": "skipped",
            "reason": "missing_config",
            "missing": ["GEMINI_API_KEY or GOOGLE_API_KEY or EVO_AGENT_GEMINI_API_KEY"],
        }
    return {"status": "passed", "model": settings.gemini_model}


def _missing_amo_settings(settings: Settings) -> list[str]:
    missing = []
    if not settings.amo_account_base_url:
        missing.append("EVO_AGENT_AMO_BASE_URL")
    if not settings.amo_client_id:
        missing.append("EVO_AGENT_AMO_CLIENT_ID")
    if not settings.amo_client_secret:
        missing.append("EVO_AGENT_AMO_CLIENT_SECRET")
    if not settings.amo_redirect_uri:
        missing.append("EVO_AGENT_AMO_REDIRECT_URI")
    if not settings.amo_refresh_token and not settings.amo_token_file.exists():
        missing.append("EVO_AGENT_AMO_REFRESH_TOKEN or EVO_AGENT_AMO_TOKEN_FILE")
    return missing


def _failed(exc: Exception) -> dict[str, str]:
    return {
        "status": "failed",
        "error_type": exc.__class__.__name__,
        "error": _error_category(exc),
    }


def _error_category(exc: Exception) -> str:
    name = exc.__class__.__name__.lower()
    if "timeout" in name:
        return "timeout"
    if "connect" in name:
        return "connection_failed"
    if "http" in name or "status" in name:
        return "http_error"
    return "request_failed"


def _read_access_token(settings: Settings) -> str | None:
    token_file = settings.amo_token_file
    if not token_file.exists():
        return None
    try:
        data = json.loads(token_file.read_text())
    except (OSError, json.JSONDecodeError):
        return None
    token = data.get("access_token")
    return token if isinstance(token, str) and token.strip() else None


def _public_waha_session(session: dict[str, Any], fallback_name: str) -> dict[str, Any]:
    found = session.get("found")
    status = session.get("status")
    name = session.get("name") or session.get("session") or fallback_name
    return {
        "name": _compact_string(name, fallback_name),
        "status": _compact_string(status, None),
        "found": bool(found) if found is not None else True,
    }


def _public_amo_account(account: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": account.get("id"),
        "name": _compact_string(account.get("name"), None),
        "subdomain": _compact_string(account.get("subdomain"), None),
    }


def _compact_string(value: object, fallback: str | None) -> str | None:
    if value is None:
        return fallback
    return str(value)[:80]


def _waha_session_is_working(status: object) -> bool:
    return isinstance(status, str) and status.strip().upper() == "WORKING"


async def _amo_account_info(settings: Settings, access_token: str) -> dict[str, Any]:
    base_url = (settings.amo_account_base_url or "").rstrip("/")
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.get(
            f"{base_url}/api/v4/account",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        response.raise_for_status()
        data = response.json() if response.content else {}
    return {
        "id": data.get("id"),
        "name": data.get("name"),
        "subdomain": data.get("subdomain"),
    }
