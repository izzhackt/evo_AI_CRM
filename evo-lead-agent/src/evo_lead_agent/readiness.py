from __future__ import annotations

from typing import Any

from .config import Settings


def build_readiness_report(
    settings: Settings, knowledge_count: int | None = None
) -> dict[str, Any]:
    runtime_missing = [
        *(["EVO_AGENT_FROZEN=false"] if settings.frozen else []),
        *(["EVO_AGENT_WORKER_ENABLED=true"] if not settings.worker_enabled else []),
    ]
    missing = {
        "admin_api": _missing_admin(settings),
        "waha_webhook": _missing_waha_webhook(settings),
        "waha_api": _missing_waha_api(settings),
        "amo": _missing_amo(settings),
        "crm_sync": _missing_crm_sync(settings),
        "gemini": _missing_gemini(settings),
    }
    stages = {
        "docker_start": _stage(True, []),
        "private_admin": _stage(not missing["admin_api"], missing["admin_api"]),
        "waha_inbound_capture": _stage(
            not runtime_missing and not missing["waha_webhook"],
            [*runtime_missing, *missing["waha_webhook"]],
        ),
        "amo_crm_shadow_sync": _stage(
            not runtime_missing
            and not missing["waha_webhook"]
            and not missing["amo"]
            and not missing["crm_sync"],
            [*runtime_missing, *missing["waha_webhook"], *missing["amo"], *missing["crm_sync"]],
        ),
        "ai_decision_review": _stage(
            not runtime_missing
            and not missing["waha_webhook"]
            and not missing["amo"]
            and not missing["crm_sync"]
            and not missing["gemini"]
            and settings.autoreply_enabled,
            [
                *runtime_missing,
                *missing["waha_webhook"],
                *missing["amo"],
                *missing["crm_sync"],
                *missing["gemini"],
                *(["EVO_AGENT_AUTOREPLY_ENABLED=true"] if not settings.autoreply_enabled else []),
            ],
        ),
        "receive_only_rollout": _stage(
            not runtime_missing
            and not missing["admin_api"]
            and not missing["waha_webhook"]
            and not missing["waha_api"]
            and not missing["amo"]
            and not missing["crm_sync"]
            and not missing["gemini"]
            and settings.autoreply_enabled
            and not settings.outbound_enabled,
            [
                *runtime_missing,
                *missing["admin_api"],
                *missing["waha_webhook"],
                *missing["waha_api"],
                *missing["amo"],
                *missing["crm_sync"],
                *missing["gemini"],
                *(["EVO_AGENT_AUTOREPLY_ENABLED=true"] if not settings.autoreply_enabled else []),
                *(["EVO_AGENT_OUTBOUND_ENABLED=false"] if settings.outbound_enabled else []),
            ],
        ),
        "live_whatsapp_outbound": _stage(
            not runtime_missing
            and not missing["waha_webhook"]
            and not missing["waha_api"]
            and not missing["amo"]
            and not missing["crm_sync"]
            and not missing["gemini"]
            and settings.autoreply_enabled
            and settings.outbound_enabled,
            [
                *runtime_missing,
                *missing["waha_webhook"],
                *missing["waha_api"],
                *missing["amo"],
                *missing["crm_sync"],
                *missing["gemini"],
                *(["EVO_AGENT_AUTOREPLY_ENABLED=true"] if not settings.autoreply_enabled else []),
                *(["EVO_AGENT_OUTBOUND_ENABLED=true"] if not settings.outbound_enabled else []),
            ],
        ),
    }
    warnings = _warnings(settings, knowledge_count)
    ready_for_receive_only = stages["receive_only_rollout"]["ok"]
    ready_for_live_outbound = stages["live_whatsapp_outbound"]["ok"] and not warnings
    return {
        "ok": ready_for_receive_only,
        "env": settings.app_env,
        "knowledge_count": knowledge_count,
        "ready": {
            "receive_only_rollout": ready_for_receive_only,
            "live_whatsapp_outbound": ready_for_live_outbound,
        },
        "safety": {
            "autoreply_enabled": settings.autoreply_enabled,
            "outbound_enabled": settings.outbound_enabled,
            "reply_delay_seconds": settings.reply_delay_seconds,
            "worker_enabled": settings.worker_enabled,
        },
        "configured": {
            "admin_api": not missing["admin_api"],
            "waha_webhook": not missing["waha_webhook"],
            "waha_api": not missing["waha_api"],
            "amo": not missing["amo"],
            "crm_sync": not missing["crm_sync"],
            "gemini": not missing["gemini"],
        },
        "stages": stages,
        "warnings": warnings,
        "next_action": _next_action(stages, warnings),
    }


def _stage(ok: bool, missing: list[str]) -> dict[str, Any]:
    return {"ok": ok, "missing": sorted(set(missing))}


def _missing_admin(settings: Settings) -> list[str]:
    return [] if settings.admin_api_key else ["EVO_AGENT_ADMIN_API_KEY"]


def _missing_waha_webhook(settings: Settings) -> list[str]:
    return [] if settings.waha_webhook_secret else ["EVO_AGENT_WAHA_WEBHOOK_SECRET"]


def _missing_waha_api(settings: Settings) -> list[str]:
    missing = []
    if not settings.waha_base_url:
        missing.append("EVO_AGENT_WAHA_BASE_URL")
    if not settings.waha_api_key:
        missing.append("EVO_AGENT_WAHA_API_KEY")
    if not settings.waha_session_name:
        missing.append("EVO_AGENT_WAHA_SESSION")
    return missing


def _missing_amo(settings: Settings) -> list[str]:
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


def _missing_crm_sync(settings: Settings) -> list[str]:
    missing = []
    if not settings.crm_base_url:
        missing.append("EVO_AGENT_CRM_BASE_URL")
    if not settings.crm_sync_secret:
        missing.append("EVO_AGENT_CRM_SYNC_SECRET")
    return missing


def _missing_gemini(settings: Settings) -> list[str]:
    return (
        []
        if settings.gemini_configured
        else ["GEMINI_API_KEY or GOOGLE_API_KEY or EVO_AGENT_GEMINI_API_KEY"]
    )


def _warnings(settings: Settings, knowledge_count: int | None) -> list[str]:
    warnings = []
    if settings.outbound_enabled and not settings.autoreply_enabled:
        warnings.append("outbound_enabled_without_autoreply")
    if settings.outbound_enabled and settings.reply_delay_seconds <= 0:
        warnings.append("live_outbound_without_reply_delay")
    if settings.autoreply_enabled and knowledge_count == 0:
        warnings.append("autoreply_enabled_without_imported_knowledge")
    if (
        settings.outbound_enabled
        and not settings.worker_enabled
        and settings.reply_delay_seconds > 0
    ):
        warnings.append("reply_delay_requires_worker_or_manual_process_due")
    return warnings


def _next_action(stages: dict[str, dict[str, Any]], warnings: list[str]) -> str:
    for name in (
        "private_admin",
        "waha_inbound_capture",
        "amo_crm_shadow_sync",
        "ai_decision_review",
        "receive_only_rollout",
    ):
        stage = stages[name]
        if not stage["ok"]:
            missing = ", ".join(stage["missing"])
            return f"configure_{name}: {missing}"
    if not stages["live_whatsapp_outbound"]["ok"]:
        return "ready_for_receive_only_rollout"
    if warnings:
        return f"review_warning: {warnings[0]}"
    return "ready_for_controlled_live_outbound"
