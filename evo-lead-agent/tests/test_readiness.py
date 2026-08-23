from dataclasses import replace
from pathlib import Path

from evo_lead_agent.config import Settings
from evo_lead_agent.readiness import build_readiness_report


def _settings(tmp_path: Path, **overrides: object) -> Settings:
    values = {
        "app_env": "test",
        "database_path": tmp_path / "agent.db",
        "waha_base_url": None,
        "waha_api_key": None,
        "waha_session_name": "evo-inbox",
        "waha_webhook_secret": None,
        "amo_account_base_url": None,
        "amo_client_id": None,
        "amo_client_secret": None,
        "amo_redirect_uri": None,
        "amo_refresh_token": None,
        "amo_token_file": tmp_path / "amo-token.json",
        "amo_pipeline_id": None,
        "amo_status_id": None,
        "amo_responsible_user_id": None,
        "crm_base_url": None,
        "crm_sync_path": "/api/internal/lead-agent/whatsapp",
        "crm_sync_secret": None,
        "crm_sync_timeout_seconds": 10,
        "admin_api_key": None,
        "gemini_api_key": None,
        "gemini_model": "gemini-3.5-flash",
        "autoreply_enabled": False,
        "outbound_enabled": False,
        "max_reply_chars": 900,
        "reply_delay_seconds": 30,
        "worker_enabled": True,
        "worker_poll_interval_seconds": 2,
    }
    values.update(overrides)
    return Settings(**values)


def test_readiness_reports_missing_live_configuration(tmp_path: Path) -> None:
    report = build_readiness_report(_settings(tmp_path), knowledge_count=0)

    assert report["ok"] is False
    assert report["stages"]["docker_start"]["ok"] is True
    assert report["stages"]["waha_inbound_capture"]["missing"] == ["EVO_AGENT_WAHA_WEBHOOK_SECRET"]
    assert "EVO_AGENT_AMO_CLIENT_ID" in report["stages"]["amo_crm_shadow_sync"]["missing"]
    assert "EVO_AGENT_ADMIN_API_KEY" in report["stages"]["receive_only_rollout"]["missing"]
    assert "GEMINI_API_KEY or GOOGLE_API_KEY or EVO_AGENT_GEMINI_API_KEY" in report["stages"]["receive_only_rollout"]["missing"]
    assert report["ready"] == {"receive_only_rollout": False, "live_whatsapp_outbound": False}
    assert report["next_action"].startswith("configure_private_admin")


def test_readiness_reports_receive_only_ready_without_outbound(tmp_path: Path) -> None:
    report = build_readiness_report(
        _settings(
            tmp_path,
            admin_api_key="admin-secret",
            waha_base_url="http://waha.internal",
            waha_api_key="waha-key",
            waha_webhook_secret="webhook-secret",
            amo_account_base_url="https://example.amocrm.ru",
            amo_client_id="client-id",
            amo_client_secret="client-secret",
            amo_redirect_uri="https://example.com/callback",
            amo_refresh_token="refresh-token",
            crm_base_url="http://crm.internal",
            crm_sync_secret="sync-secret",
            gemini_api_key="gemini-key",
            autoreply_enabled=True,
            outbound_enabled=False,
        ),
        knowledge_count=3,
    )

    assert report["ok"] is True
    assert report["ready"]["receive_only_rollout"] is True
    assert report["ready"]["live_whatsapp_outbound"] is False
    assert report["stages"]["receive_only_rollout"]["ok"] is True
    assert report["stages"]["live_whatsapp_outbound"]["ok"] is False
    assert report["stages"]["live_whatsapp_outbound"]["missing"] == ["EVO_AGENT_OUTBOUND_ENABLED=true"]
    assert report["warnings"] == []
    assert report["next_action"] == "ready_for_receive_only_rollout"


def test_readiness_reports_live_outbound_ready_when_configured(tmp_path: Path) -> None:
    report = build_readiness_report(
        _settings(
            tmp_path,
            admin_api_key="admin-secret",
            waha_base_url="http://waha.internal",
            waha_api_key="waha-key",
            waha_webhook_secret="webhook-secret",
            amo_account_base_url="https://example.amocrm.ru",
            amo_client_id="client-id",
            amo_client_secret="client-secret",
            amo_redirect_uri="https://example.com/callback",
            amo_refresh_token="refresh-token",
            crm_base_url="http://crm.internal",
            crm_sync_secret="sync-secret",
            gemini_api_key="gemini-key",
            autoreply_enabled=True,
            outbound_enabled=True,
        ),
        knowledge_count=3,
    )

    assert report["ok"] is False
    assert report["ready"]["receive_only_rollout"] is False
    assert report["ready"]["live_whatsapp_outbound"] is True
    assert report["stages"]["receive_only_rollout"]["missing"] == ["EVO_AGENT_OUTBOUND_ENABLED=false"]
    assert report["stages"]["live_whatsapp_outbound"]["ok"] is True
    assert report["warnings"] == []
    assert report["next_action"] == "configure_receive_only_rollout: EVO_AGENT_OUTBOUND_ENABLED=false"


def test_readiness_reports_freeze_as_explicit_blocker(tmp_path: Path) -> None:
    settings = replace(_settings(tmp_path), frozen=True)

    report = build_readiness_report(settings, knowledge_count=1)

    assert report["ready"]["receive_only_rollout"] is False
    assert report["ready"]["live_whatsapp_outbound"] is False
    assert report["stages"]["waha_inbound_capture"]["missing"][0] == "EVO_AGENT_FROZEN=false"


def test_readiness_report_does_not_include_secret_values(tmp_path: Path) -> None:
    secret_values = {
        "admin_api_key": "k1!",
        "waha_api_key": "k2!",
        "waha_webhook_secret": "k3!",
        "amo_client_secret": "k4!",
        "amo_refresh_token": "k5!",
        "crm_sync_secret": "k6!",
        "gemini_api_key": "k7!",
    }
    report = build_readiness_report(
        _settings(
            tmp_path,
            waha_base_url="http://waha.internal",
            amo_account_base_url="https://example.amocrm.ru",
            amo_client_id="client-id",
            amo_redirect_uri="https://example.com/callback",
            crm_base_url="http://crm.internal",
            **secret_values,
        ),
        knowledge_count=1,
    )
    rendered = str(report)

    for secret_value in secret_values.values():
        assert secret_value not in rendered


def test_readiness_warns_before_live_outbound_without_delay(tmp_path: Path) -> None:
    report = build_readiness_report(
        _settings(
            tmp_path,
            admin_api_key="admin-secret",
            waha_base_url="http://waha.internal",
            waha_api_key="waha-key",
            waha_webhook_secret="webhook-secret",
            amo_account_base_url="https://example.amocrm.ru",
            amo_client_id="client-id",
            amo_client_secret="client-secret",
            amo_redirect_uri="https://example.com/callback",
            amo_refresh_token="refresh-token",
            crm_base_url="http://crm.internal",
            crm_sync_secret="sync-secret",
            gemini_api_key="gemini-key",
            autoreply_enabled=True,
            outbound_enabled=True,
            reply_delay_seconds=0,
        ),
        knowledge_count=0,
    )

    assert "live_outbound_without_reply_delay" in report["warnings"]
    assert "autoreply_enabled_without_imported_knowledge" in report["warnings"]
    assert report["ok"] is False
