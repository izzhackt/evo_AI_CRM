from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import find_dotenv, load_dotenv


PLATFORM_WAHA_SESSION_NAME = "evo-inbox"
PLATFORM_WAHA_WEBHOOK_PATH = "/api/internal/platform-messaging/waha/events"


def _bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _optional(name: str) -> str | None:
    value = os.getenv(name)
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


def _int(name: str) -> int | None:
    raw = _optional(name)
    if raw is None:
        return None
    try:
        parsed = int(raw)
    except ValueError:
        return None
    return parsed if parsed > 0 else None


def _platform_waha_session_name() -> str:
    value = os.getenv("EVO_AGENT_WAHA_SESSION")
    if value is None:
        return PLATFORM_WAHA_SESSION_NAME
    if value != PLATFORM_WAHA_SESSION_NAME:
        raise ValueError("EVO_AGENT_WAHA_SESSION must be exactly evo-inbox")
    return value


@dataclass(frozen=True)
class Settings:
    app_env: str
    database_path: Path
    waha_base_url: str | None
    waha_api_key: str | None
    waha_session_name: str
    waha_webhook_secret: str | None
    amo_account_base_url: str | None
    amo_client_id: str | None
    amo_client_secret: str | None
    amo_redirect_uri: str | None
    amo_refresh_token: str | None
    amo_token_file: Path
    amo_pipeline_id: int | None
    amo_status_id: int | None
    amo_responsible_user_id: int | None
    crm_base_url: str | None
    crm_sync_path: str
    crm_sync_secret: str | None
    crm_sync_timeout_seconds: float
    admin_api_key: str | None
    gemini_api_key: str | None
    gemini_model: str
    autoreply_enabled: bool
    outbound_enabled: bool
    max_reply_chars: int
    reply_delay_seconds: int
    worker_enabled: bool
    worker_poll_interval_seconds: float
    frozen: bool = False
    starter_knowledge_path: Path | None = None

    @property
    def amo_configured(self) -> bool:
        return all(
            [
                self.amo_account_base_url,
                self.amo_client_id,
                self.amo_client_secret,
                self.amo_redirect_uri,
                self.amo_refresh_token or self.amo_token_file.exists(),
            ]
        )

    @property
    def waha_configured(self) -> bool:
        return bool(self.waha_base_url and self.waha_api_key and self.waha_session_name)

    @property
    def crm_sync_configured(self) -> bool:
        return bool(self.crm_base_url and self.crm_sync_secret)

    @property
    def gemini_configured(self) -> bool:
        return bool(self.gemini_api_key)


def load_settings() -> Settings:
    load_dotenv(dotenv_path=find_dotenv(usecwd=True), override=False)

    return Settings(
        app_env=os.getenv("EVO_AGENT_ENV", "local"),
        database_path=Path(os.getenv("EVO_AGENT_DB_PATH", "data/evo-lead-agent.db")),
        waha_base_url=_optional("EVO_AGENT_WAHA_BASE_URL"),
        waha_api_key=_optional("EVO_AGENT_WAHA_API_KEY"),
        waha_session_name=_platform_waha_session_name(),
        waha_webhook_secret=_optional("EVO_AGENT_WAHA_WEBHOOK_SECRET"),
        amo_account_base_url=_optional("EVO_AGENT_AMO_BASE_URL"),
        amo_client_id=_optional("EVO_AGENT_AMO_CLIENT_ID"),
        amo_client_secret=_optional("EVO_AGENT_AMO_CLIENT_SECRET"),
        amo_redirect_uri=_optional("EVO_AGENT_AMO_REDIRECT_URI"),
        amo_refresh_token=_optional("EVO_AGENT_AMO_REFRESH_TOKEN"),
        amo_token_file=Path(os.getenv("EVO_AGENT_AMO_TOKEN_FILE", "data/amo-token.json")),
        amo_pipeline_id=_int("EVO_AGENT_AMO_PIPELINE_ID"),
        amo_status_id=_int("EVO_AGENT_AMO_STATUS_ID"),
        amo_responsible_user_id=_int("EVO_AGENT_AMO_RESPONSIBLE_USER_ID"),
        crm_base_url=_optional("EVO_AGENT_CRM_BASE_URL"),
        crm_sync_path=os.getenv(
            "EVO_AGENT_CRM_SYNC_PATH",
            "/api/internal/lead-agent/whatsapp",
        ).strip()
        or "/api/internal/lead-agent/whatsapp",
        crm_sync_secret=_optional("EVO_AGENT_CRM_SYNC_SECRET"),
        crm_sync_timeout_seconds=float(os.getenv("EVO_AGENT_CRM_SYNC_TIMEOUT_SECONDS", "10")),
        admin_api_key=_optional("EVO_AGENT_ADMIN_API_KEY"),
        gemini_api_key=(
            _optional("GOOGLE_API_KEY")
            or _optional("GEMINI_API_KEY")
            or _optional("EVO_AGENT_GEMINI_API_KEY")
        ),
        gemini_model=os.getenv("EVO_AGENT_GEMINI_MODEL", "gemini-3.5-flash").strip()
        or "gemini-3.5-flash",
        autoreply_enabled=_bool("EVO_AGENT_AUTOREPLY_ENABLED", False),
        outbound_enabled=_bool("EVO_AGENT_OUTBOUND_ENABLED", False),
        max_reply_chars=int(os.getenv("EVO_AGENT_MAX_REPLY_CHARS", "900")),
        reply_delay_seconds=int(os.getenv("EVO_AGENT_REPLY_DELAY_SECONDS", "30")),
        worker_enabled=_bool("EVO_AGENT_WORKER_ENABLED", False),
        worker_poll_interval_seconds=float(os.getenv("EVO_AGENT_WORKER_POLL_INTERVAL_SECONDS", "2")),
        frozen=_bool("EVO_AGENT_FROZEN", True),
        starter_knowledge_path=(
            Path(starter_path)
            if (starter_path := os.getenv("EVO_AGENT_STARTER_KNOWLEDGE_PATH", "examples/evo-admissions-starter-knowledge.json").strip())
            else None
        ),
    )
