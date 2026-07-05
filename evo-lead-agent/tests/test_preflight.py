import json
from pathlib import Path

import pytest

from evo_lead_agent.config import Settings
from evo_lead_agent.preflight import run_preflight


def _settings(tmp_path: Path, **overrides: object) -> Settings:
    values = {
        "app_env": "test",
        "database_path": tmp_path / "agent.db",
        "waha_base_url": None,
        "waha_api_key": None,
        "waha_session_name": "crm_primary",
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
        "admin_api_key": "admin-secret",
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


@pytest.mark.asyncio
async def test_preflight_skips_checks_with_missing_config(tmp_path: Path) -> None:
    report = await run_preflight(_settings(tmp_path), knowledge_count=0)

    assert report["ok"] is False
    assert report["checks"]["admin_configuration"]["status"] == "passed"
    assert report["checks"]["waha_session"]["status"] == "skipped"
    assert report["checks"]["amo_account"]["status"] == "skipped"
    assert report["checks"]["crm_sync_signing"]["status"] == "skipped"
    assert report["checks"]["gemini_configuration"]["status"] == "skipped"
    assert "EVO_AGENT_WAHA_API_KEY" in report["checks"]["waha_session"]["missing"]
    assert "EVO_AGENT_AMO_CLIENT_ID" in report["checks"]["amo_account"]["missing"]
    assert "GEMINI_API_KEY or GOOGLE_API_KEY or EVO_AGENT_GEMINI_API_KEY" in report["checks"]["gemini_configuration"]["missing"]


@pytest.mark.asyncio
async def test_preflight_reports_missing_admin_configuration(tmp_path: Path) -> None:
    report = await run_preflight(_settings(tmp_path, admin_api_key=None), knowledge_count=0)

    assert report["ok"] is False
    assert report["checks"]["admin_configuration"] == {
        "status": "skipped",
        "reason": "missing_config",
        "missing": ["EVO_AGENT_ADMIN_API_KEY"],
    }


@pytest.mark.asyncio
async def test_preflight_runs_configured_read_only_checks(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[str] = []

    class FakeWahaClient:
        def __init__(self, base_url: str, api_key: str, session_name: str) -> None:
            calls.append(f"waha:{base_url}:{session_name}")

        async def session_info(self) -> dict[str, object]:
            return {
                "name": "crm_primary",
                "status": "WORKING",
                "found": True,
                "apiKey": "leaked-waha-key",
                "webhooks": ["http://internal/webhook"],
                "headers": {"X-Api-Key": "leaked-header"},
                "customer_phone": "+996700111222",
            }

    async def fake_amo_account_info(settings: Settings, access_token: str) -> dict[str, object]:
        calls.append(f"amo:{settings.amo_account_base_url}:{access_token}")
        return {
            "id": 100,
            "name": "EVO Admissions",
            "subdomain": "evoadmissions",
            "access_token": "tokx",
            "webhook_url": "https://example.com/webhook",
            "headers": {"Authorization": "Bearer tokx"},
            "customer": {"phone": "+996700111222"},
        }

    monkeypatch.setattr("evo_lead_agent.preflight.WahaClient", FakeWahaClient)
    monkeypatch.setattr("evo_lead_agent.preflight._amo_account_info", fake_amo_account_info)
    token_file = tmp_path / "amo-token.json"
    token_file.write_text(json.dumps({"access_token": "tok"}), encoding="utf-8")

    report = await run_preflight(
        _settings(
            tmp_path,
            waha_base_url="http://waha.internal",
            waha_api_key="waha-key",
            waha_webhook_secret="webhook-secret",
            amo_account_base_url="https://example.amocrm.ru",
            amo_client_id="client-id",
            amo_client_secret="client-secret",
            amo_redirect_uri="https://example.com/callback",
            amo_refresh_token="refresh-token",
            amo_token_file=token_file,
            crm_base_url="http://crm.internal",
            crm_sync_secret="sync-secret",
            gemini_api_key="gemini-key",
            autoreply_enabled=True,
            outbound_enabled=False,
        ),
        knowledge_count=1,
    )

    assert report["ok"] is True
    assert report["checks"]["admin_configuration"]["status"] == "passed"
    assert report["checks"]["waha_session"]["status"] == "passed"
    assert report["checks"]["waha_session"]["session"] == {
        "name": "crm_primary",
        "status": "WORKING",
        "found": True,
    }
    assert report["checks"]["amo_account"]["account"]["subdomain"] == "evoadmissions"
    assert report["checks"]["crm_sync_signing"]["signature_algorithm"] == "sha256"
    assert report["checks"]["gemini_configuration"] == {
        "status": "passed",
        "model": "gemini-3.5-flash",
    }
    assert report["readiness"]["ready"]["receive_only_rollout"] is True
    assert calls == ["waha:http://waha.internal:crm_primary", "amo:https://example.amocrm.ru:tok"]
    rendered = str(report)
    assert "leaked-waha-key" not in rendered
    assert "tokx" not in rendered
    assert "http://internal/webhook" not in rendered
    assert "https://example.com/webhook" not in rendered
    assert "+996700111222" not in rendered


@pytest.mark.asyncio
async def test_preflight_fails_receive_only_gate_when_outbound_enabled(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FakeWahaClient:
        def __init__(self, base_url: str, api_key: str, session_name: str) -> None:
            pass

        async def session_info(self) -> dict[str, object]:
            return {"name": "crm_primary", "status": "WORKING", "found": True}

    async def fake_amo_account_info(settings: Settings, access_token: str) -> dict[str, object]:
        return {"id": 100, "name": "EVO Admissions", "subdomain": "evoadmissions"}

    monkeypatch.setattr("evo_lead_agent.preflight.WahaClient", FakeWahaClient)
    monkeypatch.setattr("evo_lead_agent.preflight._amo_account_info", fake_amo_account_info)
    token_file = tmp_path / "amo-token.json"
    token_file.write_text(json.dumps({"access_token": "tok"}), encoding="utf-8")

    report = await run_preflight(
        _settings(
            tmp_path,
            waha_base_url="http://waha.internal",
            waha_api_key="waha-key",
            waha_webhook_secret="webhook-secret",
            amo_account_base_url="https://example.amocrm.ru",
            amo_client_id="client-id",
            amo_client_secret="client-secret",
            amo_redirect_uri="https://example.com/callback",
            amo_refresh_token="refresh-token",
            amo_token_file=token_file,
            crm_base_url="http://crm.internal",
            crm_sync_secret="sync-secret",
            gemini_api_key="gemini-key",
            autoreply_enabled=True,
            outbound_enabled=True,
        ),
        knowledge_count=1,
    )

    assert report["ok"] is False
    assert report["checks"]["waha_session"]["status"] == "passed"
    assert report["checks"]["amo_account"]["status"] == "passed"
    assert report["readiness"]["stages"]["receive_only_rollout"]["missing"] == [
        "EVO_AGENT_OUTBOUND_ENABLED=false"
    ]


@pytest.mark.asyncio
async def test_preflight_fails_when_waha_session_needs_qr_scan(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FakeWahaClient:
        def __init__(self, base_url: str, api_key: str, session_name: str) -> None:
            pass

        async def session_info(self) -> dict[str, object]:
            return {"name": "crm_primary", "status": "SCAN_QR", "found": True}

    monkeypatch.setattr("evo_lead_agent.preflight.WahaClient", FakeWahaClient)

    report = await run_preflight(
        _settings(
            tmp_path,
            waha_base_url="http://waha.internal",
            waha_api_key="waha-key",
        ),
        knowledge_count=1,
    )

    assert report["ok"] is False
    assert report["checks"]["waha_session"] == {
        "status": "failed",
        "reason": "session_not_working",
        "session": {"name": "crm_primary", "status": "SCAN_QR", "found": True},
    }


@pytest.mark.asyncio
async def test_preflight_does_not_refresh_amo_token_when_access_token_file_is_missing(
    tmp_path: Path,
) -> None:
    report = await run_preflight(
        _settings(
            tmp_path,
            amo_account_base_url="https://example.amocrm.ru",
            amo_client_id="client-id",
            amo_client_secret="client-secret",
            amo_redirect_uri="https://example.com/callback",
            amo_refresh_token="refresh-token",
        ),
        knowledge_count=0,
    )

    assert report["checks"]["amo_account"] == {
        "status": "skipped",
        "reason": "non_destructive_access_token_missing",
        "missing": ["EVO_AGENT_AMO_TOKEN_FILE with access_token"],
    }
    assert not (tmp_path / "amo-token.json").exists()


@pytest.mark.asyncio
async def test_preflight_sanitizes_error_messages(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FakeWahaClient:
        def __init__(self, base_url: str, api_key: str, session_name: str) -> None:
            pass

        async def session_info(self) -> dict[str, object]:
            raise RuntimeError("failed with secret-waha-key and secret-refresh-token")

    monkeypatch.setattr("evo_lead_agent.preflight.WahaClient", FakeWahaClient)

    report = await run_preflight(
        _settings(
            tmp_path,
            waha_base_url="http://waha.internal",
            waha_api_key="secret-waha-key",
        ),
        knowledge_count=0,
    )
    rendered = str(report)

    assert report["checks"]["waha_session"]["status"] == "failed"
    assert report["checks"]["waha_session"]["error"] == "request_failed"
    assert "secret-waha-key" not in rendered
    assert "secret-refresh-token" not in rendered
