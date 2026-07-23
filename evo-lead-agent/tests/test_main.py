from pathlib import Path
from dataclasses import replace
import hashlib
import hmac
import json
import logging

from fastapi.testclient import TestClient

from evo_lead_agent.config import Settings
from evo_lead_agent.main import create_app
from evo_lead_agent import service as service_module
from evo_lead_agent.store import Store


def _settings(
    tmp_path: Path,
    admin_api_key: str | None = "admin-secret",
    starter_knowledge_path: Path | None = None,
) -> Settings:
    return Settings(
        app_env="test",
        database_path=tmp_path / "agent.db",
        waha_base_url=None,
        waha_api_key=None,
        waha_session_name="crm_primary",
        waha_webhook_secret="webhook-secret",
        amo_account_base_url=None,
        amo_client_id=None,
        amo_client_secret=None,
        amo_redirect_uri=None,
        amo_refresh_token=None,
        amo_token_file=tmp_path / "amo-token.json",
        amo_pipeline_id=None,
        amo_status_id=None,
        amo_responsible_user_id=None,
        crm_base_url=None,
        crm_sync_path="/api/internal/lead-agent/whatsapp",
        crm_sync_secret=None,
        crm_sync_timeout_seconds=10,
        admin_api_key=admin_api_key,
        gemini_api_key=None,
        gemini_model="gemini-3.5-flash",
        autoreply_enabled=False,
        outbound_enabled=False,
        max_reply_chars=900,
        reply_delay_seconds=0,
        worker_enabled=False,
        worker_poll_interval_seconds=0.25,
        starter_knowledge_path=starter_knowledge_path,
    )


def test_knowledge_import_requires_admin_key(tmp_path: Path) -> None:
    client = TestClient(create_app(_settings(tmp_path, admin_api_key=None), Store(tmp_path / "agent.db")))

    response = client.post("/admin/knowledge/import", json=[])

    assert response.status_code == 503
    assert response.json()["error"] == "admin_api_key_not_configured"


def test_knowledge_import_rejects_wrong_admin_key(tmp_path: Path) -> None:
    client = TestClient(create_app(_settings(tmp_path), Store(tmp_path / "agent.db")))

    response = client.post("/admin/knowledge/import", headers={"x-evo-agent-admin-key": "wrong"}, json=[])

    assert response.status_code == 403
    assert response.json()["error"] == "invalid_admin_key"


def test_docs_and_openapi_are_not_public(tmp_path: Path) -> None:
    client = TestClient(create_app(_settings(tmp_path), Store(tmp_path / "agent.db")))

    assert client.get("/docs").status_code == 404
    assert client.get("/redoc").status_code == 404
    assert client.get("/openapi.json").status_code == 404


def test_startup_seeds_starter_knowledge_when_database_is_empty(tmp_path: Path) -> None:
    repo_root = Path(__file__).resolve().parents[1]
    starter_path = repo_root / "examples" / "evo-admissions-starter-knowledge.json"
    store = Store(tmp_path / "agent.db")

    with TestClient(create_app(_settings(tmp_path, starter_knowledge_path=starter_path), store)) as client:
        health = client.get("/health").json()

    assert health == {"ok": True, "status": "live", "ready": False, "frozen": False}
    assert store.search_knowledge("Какие документы нужны?", limit=1)[0]["external_id"] == "starter-documents-ru"


def test_startup_does_not_seed_starter_knowledge_over_existing_entries(tmp_path: Path) -> None:
    repo_root = Path(__file__).resolve().parents[1]
    starter_path = repo_root / "examples" / "evo-admissions-starter-knowledge.json"
    store = Store(tmp_path / "agent.db")
    store.upsert_knowledge_entries(
        [
            {
                "source": "manual",
                "external_id": "existing-docs",
                "question": "Какие документы нужны?",
                "answer": "Проверенный ручной ответ.",
                "language": "ru",
            }
        ]
    )

    with TestClient(create_app(_settings(tmp_path, starter_knowledge_path=starter_path), store)) as client:
        health = client.get("/health").json()

    assert health["ok"] is True
    assert store.search_knowledge("Какие документы нужны?", limit=1)[0]["external_id"] == "existing-docs"


def test_startup_does_not_crash_when_starter_knowledge_file_is_missing(tmp_path: Path) -> None:
    missing_path = tmp_path / "missing-starter.json"
    store = Store(tmp_path / "agent.db")

    with TestClient(create_app(_settings(tmp_path, starter_knowledge_path=missing_path), store)) as client:
        health = client.get("/health").json()

    assert health["ok"] is True


def test_startup_rejects_unsafe_starter_knowledge_without_logging_raw_values(
    tmp_path: Path,
    caplog,
) -> None:
    unsafe_path = tmp_path / "unsafe-starter.json"
    unsafe_path.write_text(
        json.dumps(
            {
                "entries": [
                    {
                        "source": "unsafe_test",
                        "external_id": "raw-link-https://example.com/private",
                        "question": "Какие документы нужны?",
                        "answer": "Напишите на +996 700 111 222",
                        "language": "ru",
                    }
                ]
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    store = Store(tmp_path / "agent.db")

    with caplog.at_level(logging.WARNING, logger="evo_lead_agent.main"):
        with TestClient(create_app(_settings(tmp_path, starter_knowledge_path=unsafe_path), store)) as client:
            health = client.get("/health").json()

    rendered_logs = "\n".join(record.getMessage() for record in caplog.records)
    assert health["ok"] is True
    assert "unsafe=1" in rendered_logs
    assert "+996" not in rendered_logs
    assert "example.com/private" not in rendered_logs


def test_readiness_requires_admin_key(tmp_path: Path) -> None:
    client = TestClient(create_app(_settings(tmp_path, admin_api_key=None), Store(tmp_path / "agent.db")))

    response = client.get("/admin/readiness")

    assert response.status_code == 503
    assert response.json()["error"] == "admin_api_key_not_configured"


def test_readiness_rejects_wrong_admin_key(tmp_path: Path) -> None:
    client = TestClient(create_app(_settings(tmp_path), Store(tmp_path / "agent.db")))

    response = client.get("/admin/readiness", headers={"x-evo-agent-admin-key": "wrong"})

    assert response.status_code == 403
    assert response.json()["error"] == "invalid_admin_key"


def test_preflight_requires_admin_key(tmp_path: Path) -> None:
    client = TestClient(create_app(_settings(tmp_path, admin_api_key=None), Store(tmp_path / "agent.db")))

    response = client.get("/admin/preflight")

    assert response.status_code == 503
    assert response.json()["error"] == "admin_api_key_not_configured"


def test_preflight_rejects_wrong_admin_key(tmp_path: Path) -> None:
    client = TestClient(create_app(_settings(tmp_path), Store(tmp_path / "agent.db")))

    response = client.get("/admin/preflight", headers={"x-evo-agent-admin-key": "wrong"})

    assert response.status_code == 403
    assert response.json()["error"] == "invalid_admin_key"


def test_readiness_returns_stage_report(tmp_path: Path) -> None:
    client = TestClient(create_app(_settings(tmp_path), Store(tmp_path / "agent.db")))

    response = client.get("/admin/readiness", headers={"x-evo-agent-admin-key": "admin-secret"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["stages"]["docker_start"]["ok"] is True
    assert payload["stages"]["amo_crm_shadow_sync"]["ok"] is False
    assert "EVO_AGENT_AMO_CLIENT_ID" in payload["stages"]["amo_crm_shadow_sync"]["missing"]


def test_knowledge_import_updates_health_count(tmp_path: Path) -> None:
    client = TestClient(create_app(_settings(tmp_path), Store(tmp_path / "agent.db")))

    response = client.post(
        "/admin/knowledge/import",
        headers={"x-evo-agent-admin-key": "admin-secret"},
        json={
            "entries": [
                {
                    "source": "amo_export",
                    "external_id": "lead-1-msg-1",
                    "question": "Какие документы нужны для поступления?",
                    "answer": "Обычно нужны паспорт, аттестат, транскрипт и языковой сертификат, если есть.",
                    "language": "ru",
                    "tags": ["documents"],
                }
            ]
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["imported"] == 1
    assert payload["knowledge_count"] == 1
    assert payload["review"]["unsafe_entries"] == 0
    health = client.get("/health").json()
    assert health == {"ok": True, "status": "live", "ready": False, "frozen": False}


def test_frozen_agent_is_live_but_not_ready_and_rejects_webhooks(tmp_path: Path) -> None:
    settings = replace(
        _settings(tmp_path),
        frozen=True,
        worker_enabled=True,
        autoreply_enabled=True,
        outbound_enabled=True,
    )
    client = TestClient(create_app(settings, Store(tmp_path / "agent.db")))

    health = client.get("/health")
    webhook = client.post("/webhooks/waha", content=b"{}")

    assert health.status_code == 200
    assert health.json() == {"ok": True, "status": "live", "ready": False, "frozen": True}
    assert webhook.status_code == 503
    assert webhook.json() == {"error": "lead_agent_frozen"}


def test_knowledge_import_rejects_non_object_entries(tmp_path: Path) -> None:
    client = TestClient(create_app(_settings(tmp_path), Store(tmp_path / "agent.db")))

    response = client.post(
        "/admin/knowledge/import",
        headers={"x-evo-agent-admin-key": "admin-secret"},
        json={
            "entries": [
                {"question": "Какие документы нужны?", "answer": "Паспорт и аттестат."},
                "oops",
            ]
        },
    )

    assert response.status_code == 400
    assert response.json()["error"] == "entry_must_be_object:2"


def test_knowledge_import_rejects_raw_sensitive_text(tmp_path: Path) -> None:
    store = Store(tmp_path / "agent.db")
    client = TestClient(create_app(_settings(tmp_path), store))

    response = client.post(
        "/admin/knowledge/import",
        headers={"x-evo-agent-admin-key": "admin-secret"},
        json={
            "entries": [
                {
                    "question": "Можно написать менеджеру?",
                    "answer": "Да, напишите на +996 700 111 222 или test@example.com.",
                }
            ]
        },
    )

    payload = response.json()
    assert response.status_code == 422
    assert payload["error"] == "unsafe_knowledge_entries"
    assert payload["review"]["unsafe_entries"] == 1
    assert store.knowledge_count() == 0


def test_knowledge_import_rejects_raw_sensitive_metadata(tmp_path: Path) -> None:
    store = Store(tmp_path / "agent.db")
    client = TestClient(create_app(_settings(tmp_path), store))

    response = client.post(
        "/admin/knowledge/import",
        headers={"x-evo-agent-admin-key": "admin-secret"},
        json={
            "entries": [
                {
                    "source": "amo_browser",
                    "external_id": "lead-https://example.com",
                    "question": "Какие документы нужны?",
                    "answer": "Обычно нужны паспорт, аттестат и транскрипт.",
                    "tags": ["call +996 700 111 222"],
                }
            ]
        },
    )

    payload = response.json()
    assert response.status_code == 422
    assert payload["error"] == "unsafe_knowledge_entries"
    assert payload["review"]["unsafe_entries"] == 1
    assert store.knowledge_count() == 0


def test_waha_session_status_sync_failure_returns_retryable_error(
    tmp_path: Path, monkeypatch
) -> None:
    settings = replace(
        _settings(tmp_path),
        crm_base_url="http://crm.internal",
        crm_sync_secret="sync-secret",
    )

    class FailingCrmSyncClient:
        def __init__(self, settings: Settings) -> None:
            self.settings = settings

        async def sync_session_status(self, session: str, status: str, phone: str | None) -> None:
            raise RuntimeError("crm unavailable")

    monkeypatch.setattr(service_module, "EvoCrmSyncClient", FailingCrmSyncClient)
    client = TestClient(create_app(settings, Store(settings.database_path)))
    body = json.dumps(
        {
            "event": "session.status",
            "session": "crm_primary",
            "payload": {"status": "WORKING"},
            "me": {"id": "996700111222@c.us"},
        },
        separators=(",", ":"),
    ).encode("utf-8")
    signature = hmac.new(settings.waha_webhook_secret.encode("utf-8"), body, hashlib.sha512)

    response = client.post(
        "/webhooks/waha",
        content=body,
        headers={
            "content-type": "application/json",
            "x-webhook-hmac": signature.hexdigest(),
            "x-webhook-hmac-algorithm": "sha512",
        },
    )

    assert response.status_code == 503
    assert response.json() == {
        "detail": {"error": "webhook_processing_retryable", "reason": "crm_sync_failed"}
    }
