import json
from pathlib import Path

import httpx
import pytest

from evo_lead_agent.cli import (
    build_smoke_waha_payload,
    build_waha_session_payload,
    draft_knowledge_entries,
    draft_knowledge_entries_from_turns,
    draft_knowledge_main,
    draft_knowledge_meta,
    draft_turns_meta,
    env_audit_main,
    import_knowledge_main,
    load_knowledge_entries,
    load_turns,
    local_smoke_main,
    preflight_main,
    readiness_main,
    review_knowledge_entries,
    smoke_waha_webhook_main,
    waha_setup_main,
)
from evo_lead_agent.security import verify_waha_hmac
from evo_lead_agent.store import Store


def test_cli_loads_json_entries_object(tmp_path: Path) -> None:
    path = tmp_path / "knowledge.json"
    path.write_text(
        json.dumps(
            {
                "entries": [
                    {
                        "source": "amo_browser",
                        "external_id": "lead-1-docs",
                        "question": "Какие документы нужны?",
                        "answer": "Обычно нужны паспорт, аттестат и транскрипт.",
                        "language": "ru",
                        "tags": ["documents"],
                    }
                ]
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    entries = load_knowledge_entries(path)

    assert len(entries) == 1
    assert entries[0]["external_id"] == "lead-1-docs"


def test_cli_loads_jsonl_entries(tmp_path: Path) -> None:
    path = tmp_path / "knowledge.jsonl"
    path.write_text(
        "\n".join(
            [
                json.dumps(
                    {
                        "source": "amo_browser",
                        "external_id": "lead-1-price",
                        "question": "Сколько стоит обучение?",
                        "answer": "Стоимость зависит от страны, программы и пакета сопровождения.",
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "source": "amo_browser",
                        "external_id": "lead-2-visa",
                        "question": "Помогаете с визой?",
                        "answer": "Мы помогаем подготовить документы, решение принимает консульство.",
                    },
                    ensure_ascii=False,
                ),
            ]
        ),
        encoding="utf-8",
    )

    entries = load_knowledge_entries(path)

    assert [entry["external_id"] for entry in entries] == ["lead-1-price", "lead-2-visa"]


def test_cli_loads_structured_turns(tmp_path: Path) -> None:
    path = tmp_path / "turns.json"
    path.write_text(
        json.dumps(
            {
                "turns": [
                    {"role": "customer", "text": "Какие документы нужны? +996 700 111 222"},
                    {"role": "answerer", "text": "Обычно нужны паспорт и аттестат."},
                ]
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    turns = load_turns(path)

    assert turns == [
        {"role": "customer", "text": "Какие документы нужны? [phone]"},
        {"role": "answerer", "text": "Обычно нужны паспорт и аттестат."},
    ]


def test_cli_rejects_invalid_turn_role(tmp_path: Path) -> None:
    path = tmp_path / "turns.json"
    path.write_text(json.dumps([{"role": "manager", "text": "Ответ"}]), encoding="utf-8")

    with pytest.raises(ValueError, match="turn_role_invalid:1"):
        load_turns(path)


def test_cli_imports_knowledge_into_requested_database(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    source = tmp_path / "knowledge.json"
    database = tmp_path / "agent.db"
    source.write_text(
        json.dumps(
            [
                {
                    "source": "amo_browser",
                    "external_id": "lead-1-docs",
                    "question": "Какие документы нужны?",
                    "answer": "Обычно нужны паспорт, аттестат и транскрипт.",
                }
            ],
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    exit_code = import_knowledge_main([str(source), "--db", str(database)])
    output = json.loads(capsys.readouterr().out)

    assert exit_code == 0
    assert output["imported"] == 1
    assert Store(database).knowledge_count() == 1


def test_cli_imports_committed_starter_knowledge_pack(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    repo_root = Path(__file__).resolve().parents[1]
    source = repo_root / "examples" / "evo-admissions-starter-knowledge.json"
    database = tmp_path / "agent.db"

    entries = load_knowledge_entries(source)
    review = review_knowledge_entries(entries)
    exit_code = import_knowledge_main([str(source), "--db", str(database), "--pretty"])
    output = json.loads(capsys.readouterr().out)

    assert review["ok"] is True
    assert review["unsafe_entries"] == 0
    assert review["warning_entries"] == 0
    assert exit_code == 0
    assert output["imported"] == 12
    assert Store(database).knowledge_count() == 12


def test_cli_import_dry_run_does_not_create_database(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    source = tmp_path / "knowledge.json"
    database = tmp_path / "agent.db"
    source.write_text(
        json.dumps(
            {
                "entries": [
                    {
                        "source": "amo_browser",
                        "question": "Какие документы нужны?",
                        "answer": "Обычно нужны паспорт, аттестат и транскрипт.",
                    }
                ]
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    exit_code = import_knowledge_main([str(source), "--db", str(database), "--dry-run"])
    output = json.loads(capsys.readouterr().out)

    assert exit_code == 0
    assert output["ok"] is True
    assert output["dry_run"] is True
    assert output["importable_entries"] == 1
    assert not database.exists()


def test_cli_env_audit_reports_missing_config_without_secret_values(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.chdir(tmp_path)
    for key in [
        "EVO_AGENT_ADMIN_API_KEY",
        "EVO_AGENT_WAHA_API_KEY",
        "EVO_AGENT_WAHA_WEBHOOK_SECRET",
        "EVO_AGENT_WAHA_WEBHOOK_URL",
        "EVO_AGENT_AMO_BASE_URL",
        "EVO_AGENT_AMO_CLIENT_ID",
        "EVO_AGENT_AMO_CLIENT_SECRET",
        "EVO_AGENT_AMO_REDIRECT_URI",
        "EVO_AGENT_AMO_REFRESH_TOKEN",
        "EVO_AGENT_CRM_SYNC_SECRET",
        "GEMINI_API_KEY",
    ]:
        monkeypatch.delenv(key, raising=False)

    exit_code = env_audit_main(["--db", str(tmp_path / "agent.db")])
    output = json.loads(capsys.readouterr().out)

    assert exit_code == 1
    assert output["ok"] is False
    assert output["dotenv_loaded"] is False
    assert output["ready"]["local_smoke"] is False
    assert output["ready"]["waha_setup"] is False
    assert output["ready"]["receive_only_rollout"] is False
    assert "EVO_AGENT_ADMIN_API_KEY" in output["missing"]["local_smoke"]
    assert "EVO_AGENT_WAHA_WEBHOOK_URL" in output["missing"]["waha_setup"]
    assert "EVO_AGENT_ADMIN_API_KEY" in output["missing"]["receive_only_rollout"]
    assert "EVO_AGENT_AMO_CLIENT_ID" in output["missing"]["live_preflight"]
    assert "GEMINI_API_KEY or GOOGLE_API_KEY or EVO_AGENT_GEMINI_API_KEY" in output["missing"]["live_preflight"]


def test_cli_env_audit_passes_receive_only_preflight_without_enabling_outbound(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.chdir(tmp_path)
    token_file = tmp_path / "amo-token.json"
    token_file.write_text(json.dumps({"access_token": "tok"}), encoding="utf-8")
    database = tmp_path / "agent.db"
    Store(database).upsert_knowledge_entries(
        [
            {
                "source": "test",
                "external_id": "entry-1",
                "question": "Какие документы нужны?",
                "answer": "Обычно нужны паспорт, аттестат и транскрипт.",
                "language": "ru",
                "tags": ["documents"],
            }
        ]
    )
    secret_values = {
        "EVO_AGENT_ADMIN_API_KEY": "secret-admin",
        "EVO_AGENT_WAHA_BASE_URL": "http://waha.internal",
        "EVO_AGENT_WAHA_API_KEY": "secret-waha",
        "EVO_AGENT_WAHA_WEBHOOK_SECRET": "secret-webhook",
        "EVO_AGENT_WAHA_WEBHOOK_URL": "http://lead-agent:8000/webhooks/waha",
        "EVO_AGENT_AMO_BASE_URL": "https://example.amocrm.ru",
        "EVO_AGENT_AMO_CLIENT_ID": "secret-client-id",
        "EVO_AGENT_AMO_CLIENT_SECRET": "secret-client-secret",
        "EVO_AGENT_AMO_REDIRECT_URI": "https://example.com/callback",
        "EVO_AGENT_AMO_TOKEN_FILE": str(token_file),
        "EVO_AGENT_CRM_BASE_URL": "http://crm.internal",
        "EVO_AGENT_CRM_SYNC_SECRET": "secret-crm-sync",
        "GEMINI_API_KEY": "secret-gemini",
    }
    for key, value in secret_values.items():
        monkeypatch.setenv(key, value)
        monkeypatch.setenv("EVO_AGENT_AUTOREPLY_ENABLED", "true")
        monkeypatch.setenv("EVO_AGENT_OUTBOUND_ENABLED", "false")
        monkeypatch.setenv("EVO_AGENT_FROZEN", "false")
        monkeypatch.setenv("EVO_AGENT_WORKER_ENABLED", "true")

    exit_code = env_audit_main(["--db", str(database)])
    rendered = capsys.readouterr().out
    output = json.loads(rendered)

    assert exit_code == 0
    assert output["ok"] is True
    assert output["knowledge_count"] == 1
    assert output["ready"]["live_preflight"] is True
    assert output["ready"]["ai_decision_review"] is True
    assert output["ready"]["receive_only_rollout"] is True
    assert output["ready"]["live_whatsapp_outbound"] is False
    assert output["missing"]["live_preflight"] == []
    assert output["missing"]["ai_decision_review"] == []
    assert output["missing"]["receive_only_rollout"] == []
    assert output["missing"]["live_whatsapp_outbound"] == ["EVO_AGENT_OUTBOUND_ENABLED=true"]
    assert output["next_action"] == "ready_for_receive_only_rollout"
    for secret in secret_values.values():
        assert secret not in rendered


def test_cli_import_rejects_raw_sensitive_text(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    source = tmp_path / "knowledge.json"
    database = tmp_path / "agent.db"
    source.write_text(
        json.dumps(
            [
                {
                    "question": "Можно написать менеджеру?",
                    "answer": "Да, напишите на +996 700 111 222 или test@example.com.",
                }
            ],
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    exit_code = import_knowledge_main([str(source), "--db", str(database)])
    output = json.loads(capsys.readouterr().out)

    assert exit_code == 1
    assert output["ok"] is False
    assert output["unsafe_entries"] == 1
    assert output["issues"][0]["unsafe"] == ["raw_phone_email_or_link"]
    assert not database.exists()


def test_cli_import_rejects_raw_sensitive_metadata(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    source = tmp_path / "knowledge.json"
    database = tmp_path / "agent.db"
    source.write_text(
        json.dumps(
            [
                {
                    "source": "amo_browser",
                    "external_id": "lead-https://example.com",
                    "question": "Какие документы нужны?",
                    "answer": "Обычно нужны паспорт, аттестат и транскрипт.",
                    "tags": ["call +996 700 111 222"],
                }
            ],
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    exit_code = import_knowledge_main([str(source), "--db", str(database)])
    output = json.loads(capsys.readouterr().out)

    assert exit_code == 1
    assert output["ok"] is False
    assert output["unsafe_entries"] == 1
    assert output["issues"][0]["unsafe"] == ["raw_phone_email_or_link"]
    assert not database.exists()


def test_cli_readiness_reports_missing_config(
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    database = tmp_path / "agent.db"
    monkeypatch.delenv("EVO_AGENT_ADMIN_API_KEY", raising=False)
    monkeypatch.delenv("EVO_AGENT_WAHA_WEBHOOK_SECRET", raising=False)
    monkeypatch.setenv("EVO_AGENT_DB_PATH", str(database))

    exit_code = readiness_main(["--db", str(database)])
    output = json.loads(capsys.readouterr().out)

    assert exit_code == 1
    assert output["stages"]["docker_start"]["ok"] is True
    assert output["stages"]["private_admin"]["missing"] == ["EVO_AGENT_ADMIN_API_KEY"]
    assert output["knowledge_count"] == 0


def test_cli_readiness_returns_success_when_receive_only_ready(
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    database = tmp_path / "agent.db"
    Store(database).upsert_knowledge_entries(
        [
            {
                "question": "Какие документы нужны?",
                "answer": "Обычно нужны паспорт, аттестат и транскрипт.",
            }
        ]
    )
    monkeypatch.setenv("EVO_AGENT_DB_PATH", str(database))
    monkeypatch.setenv("EVO_AGENT_ADMIN_API_KEY", "admin-secret")
    monkeypatch.setenv("EVO_AGENT_WAHA_BASE_URL", "http://waha.internal")
    monkeypatch.setenv("EVO_AGENT_WAHA_API_KEY", "waha-key")
    monkeypatch.setenv("EVO_AGENT_WAHA_WEBHOOK_SECRET", "webhook-secret")
    monkeypatch.setenv("EVO_AGENT_AMO_BASE_URL", "https://example.amocrm.ru")
    monkeypatch.setenv("EVO_AGENT_AMO_CLIENT_ID", "client-id")
    monkeypatch.setenv("EVO_AGENT_AMO_CLIENT_SECRET", "client-secret")
    monkeypatch.setenv("EVO_AGENT_AMO_REDIRECT_URI", "https://example.com/callback")
    monkeypatch.setenv("EVO_AGENT_AMO_REFRESH_TOKEN", "refresh-token")
    monkeypatch.setenv("EVO_AGENT_CRM_BASE_URL", "http://crm.internal")
    monkeypatch.setenv("EVO_AGENT_CRM_SYNC_SECRET", "sync-secret")
    monkeypatch.setenv("GEMINI_API_KEY", "gemini-key")
    monkeypatch.setenv("EVO_AGENT_AUTOREPLY_ENABLED", "true")
    monkeypatch.setenv("EVO_AGENT_OUTBOUND_ENABLED", "false")
    monkeypatch.setenv("EVO_AGENT_FROZEN", "false")
    monkeypatch.setenv("EVO_AGENT_WORKER_ENABLED", "true")

    exit_code = readiness_main(["--db", str(database)])
    output = json.loads(capsys.readouterr().out)

    assert exit_code == 0
    assert output["ok"] is True
    assert output["ready"]["receive_only_rollout"] is True
    assert output["ready"]["live_whatsapp_outbound"] is False
    assert output["stages"]["receive_only_rollout"]["ok"] is True
    assert output["stages"]["live_whatsapp_outbound"]["missing"] == ["EVO_AGENT_OUTBOUND_ENABLED=true"]


def test_cli_preflight_reports_skipped_missing_config(
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    database = tmp_path / "agent.db"
    monkeypatch.setenv("EVO_AGENT_DB_PATH", str(database))
    monkeypatch.delenv("EVO_AGENT_WAHA_API_KEY", raising=False)

    exit_code = preflight_main(["--db", str(database)])
    output = json.loads(capsys.readouterr().out)

    assert exit_code == 1
    assert output["ok"] is False
    assert output["checks"]["waha_session"]["status"] == "skipped"
    assert "EVO_AGENT_WAHA_API_KEY" in output["checks"]["waha_session"]["missing"]


def test_cli_builds_waha_smoke_payload() -> None:
    payload = build_smoke_waha_payload(
        phone="+996 700 111 222",
        message="Здравствуйте",
        provider_message_id="smoke-1",
        session="crm_primary",
    )

    assert payload["event"] == "message"
    assert payload["session"] == "crm_primary"
    assert payload["payload"]["id"] == "smoke-1"
    assert payload["payload"]["from"] == "996700111222@c.us"
    assert payload["payload"]["fromMe"] is False
    assert payload["payload"]["body"] == "Здравствуйте"


def test_cli_builds_waha_session_payload() -> None:
    payload = build_waha_session_payload(
        session="crm_primary",
        webhook_url="http://host.docker.internal:8088/webhooks/waha",
        webhook_secret="webhook-secret",
        events=["message", "session.status"],
    )

    assert payload == {
        "name": "crm_primary",
        "start": True,
        "config": {
            "webhooks": [
                {
                    "url": "http://host.docker.internal:8088/webhooks/waha",
                    "events": ["message", "session.status"],
                    "hmac": {"key": "webhook-secret"},
                    "retries": {
                        "policy": "linear",
                        "delaySeconds": 2,
                        "attempts": 4,
                    },
                }
            ]
        },
    }


def test_cli_waha_session_payload_respects_no_start_and_required_events() -> None:
    payload = build_waha_session_payload(
        session="crm_primary",
        webhook_url="http://host.docker.internal:8088/webhooks/waha",
        webhook_secret="webhook-secret",
        events=["message"],
        start=False,
    )

    assert payload["start"] is False
    assert payload["config"]["webhooks"][0]["events"] == ["message", "session.status"]


def test_cli_waha_setup_configures_starts_and_saves_qr_without_leaking_secrets(
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[str, str, dict[str, object] | None]] = []
    qr_output = tmp_path / "qr.png"

    class FakeClient:
        def __enter__(self) -> "FakeClient":
            return self

        def __exit__(self, *_args: object) -> None:
            return None

        def get(self, url: str, headers: dict[str, str] | None = None) -> httpx.Response:
            assert headers is not None
            assert headers["X-Api-Key"] == "waha-key"
            if url.endswith("/api/sessions/crm_primary"):
                calls.append(("GET", url, None))
                return httpx.Response(404, json={"error": "not_found"})
            if url.endswith("/api/crm_primary/auth/qr"):
                calls.append(("GET", url, None))
                return httpx.Response(200, content=b"\x89PNG\r\n")
            raise AssertionError(url)

        def post(
            self,
            url: str,
            content: bytes | None = None,
            json: dict[str, object] | None = None,  # noqa: A002
            headers: dict[str, str] | None = None,
        ) -> httpx.Response:
            assert content is None
            assert headers is not None
            assert headers["X-Api-Key"] == "waha-key"
            calls.append(("POST", url, json))
            return httpx.Response(201 if url.endswith("/api/sessions/") else 200, json={"name": "crm_primary"})

    monkeypatch.setattr("evo_lead_agent.cli.httpx.Client", lambda timeout: FakeClient())

    exit_code = waha_setup_main(
        [
            "--base-url",
            "http://waha.internal",
            "--api-key",
            "waha-key",
            "--session",
            "crm_primary",
            "--webhook-url",
            "http://host.docker.internal:8088/webhooks/waha",
            "--webhook-secret",
            "webhook-secret",
            "--qr-output",
            str(qr_output),
        ]
    )
    output_text = capsys.readouterr().out
    output = json.loads(output_text)

    assert exit_code == 0
    assert output["ok"] is True
    assert output["configure"] == {"action": "created", "ok": True, "status_code": 201}
    assert output["start"] == {"requested": True, "ok": True, "status_code": 200}
    assert output["qr"]["saved"] == str(qr_output)
    assert qr_output.read_bytes() == b"\x89PNG\r\n"
    assert "waha-key" not in output_text
    assert "webhook-secret" not in output_text
    assert "host.docker.internal" not in output_text
    assert calls[1][2] is not None
    assert calls[1][2]["start"] is True
    assert calls[1][2]["config"]["webhooks"][0]["events"] == ["message", "session.status"]


def test_cli_waha_setup_no_start_is_sent_on_create(
    capsys: pytest.CaptureFixture[str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    posted: list[dict[str, object]] = []

    class FakeClient:
        def __enter__(self) -> "FakeClient":
            return self

        def __exit__(self, *_args: object) -> None:
            return None

        def get(self, url: str, headers: dict[str, str] | None = None) -> httpx.Response:
            return httpx.Response(404, json={"error": "not_found"})

        def post(
            self,
            url: str,
            content: bytes | None = None,
            json: dict[str, object] | None = None,  # noqa: A002
            headers: dict[str, str] | None = None,
        ) -> httpx.Response:
            assert json is not None
            posted.append(json)
            return httpx.Response(201, json={"name": "crm_primary"})

    monkeypatch.setattr("evo_lead_agent.cli.httpx.Client", lambda timeout: FakeClient())

    exit_code = waha_setup_main(
        [
            "--base-url",
            "http://waha.internal",
            "--api-key",
            "waha-key",
            "--webhook-url",
            "http://host.docker.internal:8088/webhooks/waha",
            "--webhook-secret",
            "webhook-secret",
            "--events",
            "message",
            "--no-start",
        ]
    )
    output = json.loads(capsys.readouterr().out)

    assert exit_code == 0
    assert output["events"] == ["message", "session.status"]
    assert output["start"] == {"requested": False, "ok": None, "status_code": None}
    assert posted[0]["start"] is False
    assert posted[0]["config"]["webhooks"][0]["events"] == ["message", "session.status"]


def test_cli_waha_setup_dry_run_does_not_call_waha(
    capsys: pytest.CaptureFixture[str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fail_client(timeout: float) -> object:
        raise AssertionError("dry-run must not create an HTTP client")

    monkeypatch.setattr("evo_lead_agent.cli.httpx.Client", fail_client)

    exit_code = waha_setup_main(
        [
            "--base-url",
            "http://waha.internal",
            "--api-key",
            "waha-key",
            "--webhook-url",
            "http://host.docker.internal:8088/webhooks/waha",
            "--webhook-secret",
            "webhook-secret",
            "--qr-output",
            "data/waha-qr.png",
            "--dry-run",
        ]
    )
    output_text = capsys.readouterr().out
    output = json.loads(output_text)

    assert exit_code == 0
    assert output["ok"] is True
    assert output["dry_run"] is True
    assert output["start"] == {"requested": True}
    assert output["qr"] == {"requested": True}
    assert "waha-key" not in output_text
    assert "webhook-secret" not in output_text
    assert "host.docker.internal" not in output_text


def test_cli_waha_setup_stops_when_session_lookup_fails(
    capsys: pytest.CaptureFixture[str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[str, str]] = []

    class FakeClient:
        def __enter__(self) -> "FakeClient":
            return self

        def __exit__(self, *_args: object) -> None:
            return None

        def get(self, url: str, headers: dict[str, str] | None = None) -> httpx.Response:
            calls.append(("GET", url))
            return httpx.Response(401, json={"error": "unauthorized"})

        def post(
            self,
            url: str,
            content: bytes | None = None,
            json: dict[str, object] | None = None,  # noqa: A002, ARG002
            headers: dict[str, str] | None = None,
        ) -> httpx.Response:
            calls.append(("POST", url))
            raise AssertionError("setup must not mutate WAHA after failed lookup")

    monkeypatch.setattr("evo_lead_agent.cli.httpx.Client", lambda timeout: FakeClient())

    exit_code = waha_setup_main(
        [
            "--base-url",
            "http://waha.internal",
            "--api-key",
            "waha-key",
            "--webhook-url",
            "http://host.docker.internal:8088/webhooks/waha",
            "--webhook-secret",
            "webhook-secret",
        ]
    )
    output = json.loads(capsys.readouterr().out)

    assert exit_code == 1
    assert calls == [("GET", "http://waha.internal/api/sessions/crm_primary")]
    assert output["ok"] is False
    assert output["configure"] == {
        "action": "check_session",
        "ok": False,
        "status_code": 401,
        "reason": "session_lookup_failed",
    }


def test_cli_waha_setup_requires_real_waha_config(
    capsys: pytest.CaptureFixture[str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("EVO_AGENT_WAHA_WEBHOOK_URL", raising=False)

    exit_code = waha_setup_main([])
    output = json.loads(capsys.readouterr().out)

    assert exit_code == 2
    assert output["ok"] is False
    assert "EVO_AGENT_WAHA_API_KEY" in output["missing"]
    assert "EVO_AGENT_WAHA_WEBHOOK_URL or --webhook-url" in output["missing"]


def test_cli_smoke_waha_webhook_requires_secret(
    capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("EVO_AGENT_WAHA_WEBHOOK_SECRET", raising=False)

    exit_code = smoke_waha_webhook_main(["--base-url", "http://127.0.0.1:8088"])
    output = json.loads(capsys.readouterr().out)

    assert exit_code == 2
    assert output == {"ok": False, "error": "waha_webhook_secret_required"}


def test_cli_smoke_waha_webhook_rejects_invalid_phone(
    capsys: pytest.CaptureFixture[str],
) -> None:
    exit_code = smoke_waha_webhook_main(["--secret", "webhook-secret", "--phone", "123"])
    output = json.loads(capsys.readouterr().out)

    assert exit_code == 2
    assert output == {"ok": False, "error": "phone_must_have_at_least_8_digits"}


def test_cli_smoke_waha_webhook_sends_signed_payload(
    capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    captured: dict[str, object] = {}

    def fake_post(
        url: str,
        content: bytes,
        headers: dict[str, str],
        timeout: float,
    ) -> httpx.Response:
        captured["url"] = url
        captured["content"] = content
        captured["headers"] = headers
        captured["timeout"] = timeout
        return httpx.Response(200, json={"accepted": True, "queued": True})

    monkeypatch.setattr("evo_lead_agent.cli.httpx.post", fake_post)

    exit_code = smoke_waha_webhook_main(
        [
            "--base-url",
            "http://127.0.0.1:8088/",
            "--secret",
            "webhook-secret",
            "--session",
            "crm_primary",
            "--phone",
            "+996 700 111 222",
            "--message",
            "Smoke",
            "--provider-message-id",
            "smoke-fixed",
        ]
    )
    output = json.loads(capsys.readouterr().out)

    assert exit_code == 0
    assert output["ok"] is True
    assert output["status_code"] == 200
    assert output["provider_message_id"] == "smoke-fixed"
    assert output["accepted"] is True
    assert output["queued"] is True
    assert "chat_id" not in output
    assert "url" not in output
    assert "response" not in output
    assert captured["url"] == "http://127.0.0.1:8088/webhooks/waha"
    headers = captured["headers"]
    assert isinstance(headers, dict)
    assert headers["X-Webhook-Hmac-Algorithm"] == "sha512"
    assert verify_waha_hmac(
        captured["content"],
        "webhook-secret",
        headers["X-Webhook-Hmac"],
        headers["X-Webhook-Hmac-Algorithm"],
    )


def test_cli_local_smoke_passes_with_compact_no_outbound_report(
    capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    class FakeClient:
        def __enter__(self) -> "FakeClient":
            return self

        def __exit__(self, *_args: object) -> None:
            return None

        def get(self, url: str, headers: dict[str, str] | None = None) -> httpx.Response:
            assert "admin-secret" in (headers or {}).values() or url.endswith("/health")
            if url.endswith("/health"):
                return httpx.Response(
                    200,
                    json={
                        "ok": True,
                        "knowledge_count": 12,
                        "autoreply_enabled": False,
                        "outbound_enabled": False,
                        "worker_enabled": False,
                    },
                )
            if url.endswith("/admin/readiness"):
                return httpx.Response(
                    200,
                    json={
                        "ok": False,
                        "knowledge_count": 12,
                        "configured": {"admin_api": True, "waha_webhook": True},
                        "safety": {"autoreply_enabled": False, "outbound_enabled": False},
                        "warnings": [],
                        "next_action": "configure_amo_crm_shadow_sync",
                    },
                )
            return httpx.Response(
                200,
                json={
                    "ok": False,
                    "checks": {
                        "waha_session": {
                            "status": "skipped",
                            "reason": "missing_config",
                            "missing": ["EVO_AGENT_WAHA_API_KEY"],
                        },
                        "amo_account": {
                            "status": "skipped",
                            "reason": "non_destructive_access_token_missing",
                            "missing": ["EVO_AGENT_AMO_TOKEN_FILE with access_token"],
                        },
                    },
                },
            )

        def post(
            self,
            url: str,
            content: bytes,
            headers: dict[str, str] | None = None,
        ) -> httpx.Response:
            assert url.endswith("/webhooks/waha")
            assert headers is not None
            assert verify_waha_hmac(
                content,
                "webhook-secret",
                headers["X-Webhook-Hmac"],
                headers["X-Webhook-Hmac-Algorithm"],
            )
            return httpx.Response(
                200,
                json={
                    "accepted": True,
                    "queued": True,
                    "processed": {
                        "processed_count": 1,
                        "results": [
                            {
                                "message_count": 1,
                                "reason": "amo_not_configured",
                                "retryable": True,
                            }
                        ],
                    },
                },
            )

    monkeypatch.setattr("evo_lead_agent.cli.httpx.Client", lambda timeout: FakeClient())

    exit_code = local_smoke_main(
        [
            "--base-url",
            "http://127.0.0.1:8088/",
            "--admin-key",
            "admin-secret",
            "--webhook-secret",
            "webhook-secret",
        ]
    )
    output_text = capsys.readouterr().out
    output = json.loads(output_text)

    assert exit_code == 0
    assert output["ok"] is True
    assert output["base_url"] == "http://127.0.0.1:8088"
    assert output["checks"]["health"]["knowledge_count"] == 12
    assert output["checks"]["signed_webhook"]["processed"]["results"][0]["reason"] == "amo_not_configured"
    assert "admin-secret" not in output_text
    assert "webhook-secret" not in output_text
    assert "X-Webhook-Hmac" not in output_text


def test_cli_local_smoke_fails_when_outbound_is_enabled(
    capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    class FakeClient:
        def __enter__(self) -> "FakeClient":
            return self

        def __exit__(self, *_args: object) -> None:
            return None

        def get(self, url: str, headers: dict[str, str] | None = None) -> httpx.Response:
            if url.endswith("/health"):
                return httpx.Response(
                    200,
                    json={
                        "ok": True,
                        "knowledge_count": 12,
                        "autoreply_enabled": True,
                        "outbound_enabled": True,
                        "worker_enabled": True,
                    },
                )
            return httpx.Response(200, json={"ok": False, "configured": {}, "checks": {}})

        def post(
            self,
            url: str,
            content: bytes,
            headers: dict[str, str] | None = None,
        ) -> httpx.Response:
            return httpx.Response(200, json={"accepted": True, "queued": True})

    monkeypatch.setattr("evo_lead_agent.cli.httpx.Client", lambda timeout: FakeClient())

    exit_code = local_smoke_main(
        [
            "--admin-key",
            "admin-secret",
            "--webhook-secret",
            "webhook-secret",
        ]
    )
    output = json.loads(capsys.readouterr().out)

    assert exit_code == 1
    assert output["ok"] is False
    assert output["checks"]["health"]["ok"] is False
    assert output["warnings"] == ["outbound_enabled_must_be_false_for_local_smoke"]


def test_cli_rejects_jsonl_non_object_line(tmp_path: Path) -> None:
    path = tmp_path / "knowledge.jsonl"
    path.write_text('["not", "an", "object"]\n', encoding="utf-8")

    with pytest.raises(ValueError, match="jsonl_line_must_be_object:1"):
        load_knowledge_entries(path)


def test_cli_rejects_json_array_with_non_object_entry(tmp_path: Path) -> None:
    path = tmp_path / "knowledge.json"
    path.write_text(
        json.dumps(
            [
                {"question": "Какие документы нужны?", "answer": "Паспорт и аттестат."},
                "oops",
            ],
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="entry_must_be_object:2"):
        load_knowledge_entries(path)


def test_cli_drafts_redacted_knowledge_from_chat_transcript() -> None:
    transcript = """
amoCRM: Сделка #1
Клиент: Какие документы нужны для поступления?
Менеджер: Обычно нужны паспорт +996 700 111 222, аттестат, транскрипт и сертификат IELTS.
Клиент: Мой email test@example.com, сайт https://example.com
Клиент: Сколько стоит обучение?
Менеджер: Стоимость зависит от страны, университета и программы. Менеджер уточнит цели и предложит варианты.
"""

    entries = draft_knowledge_entries(transcript)

    assert len(entries) == 2
    assert entries[0]["question"] == "Какие документы нужны для поступления?"
    assert "[phone]" in entries[0]["answer"]
    assert "+996" not in entries[0]["answer"]
    assert "test@example.com" not in entries[0]["answer"]
    assert "documents" in entries[0]["tags"]
    assert "language" in entries[0]["tags"]
    assert "price" in entries[1]["tags"]


def test_cli_drafts_knowledge_from_structured_turns() -> None:
    turns = [
        {"role": "customer", "text": "Какие документы нужны для поступления?"},
        {"role": "customer", "text": "Меня зовут Айжан, я учусь в школе номер 5"},
        {
            "role": "answerer",
            "text": "Обычно нужны паспорт, аттестат, транскрипт и языковой сертификат.",
        },
        {"role": "customer", "text": "Сколько стоит обучение?"},
        {
            "role": "answerer",
            "text": "Стоимость зависит от страны, университета и программы.",
        },
    ]

    entries = draft_knowledge_entries_from_turns(turns)

    assert len(entries) == 2
    assert entries[0]["question"] == "Какие документы нужны для поступления?"
    assert "Айжан" not in entries[0]["answer"]
    assert "documents" in entries[0]["tags"]
    assert "price" in entries[1]["tags"]


def test_cli_structured_turns_extract_generic_question_clause() -> None:
    turns = [
        {"role": "customer", "text": "Я Айжан, какие документы нужны для поступления?"},
        {
            "role": "answerer",
            "text": "Обычно нужны паспорт, аттестат, транскрипт и языковой сертификат.",
        },
    ]

    entries = draft_knowledge_entries_from_turns(turns)

    assert len(entries) == 1
    assert entries[0]["question"] == "Какие документы нужны для поступления?"
    assert "Айжан" not in entries[0]["question"]


def test_cli_structured_turns_stop_answer_after_customer_tail() -> None:
    turns = [
        {"role": "customer", "text": "Какие документы нужны для поступления?"},
        {"role": "answerer", "text": "Обычно нужны паспорт, аттестат и транскрипт."},
        {"role": "customer", "text": "Спасибо"},
        {"role": "answerer", "text": "Хорошо, будем ждать ваши документы."},
    ]

    entries = draft_knowledge_entries_from_turns(turns)

    assert len(entries) == 1
    assert entries[0]["answer"] == "Обычно нужны паспорт, аттестат и транскрипт."
    assert "будем ждать" not in entries[0]["answer"]


def test_cli_structured_turns_rescue_manager_answer_with_wrong_role() -> None:
    turns = [
        {"role": "customer", "text": "Какие страны для обучения вы рассматриваете?"},
        {
            "role": "customer",
            "text": (
                "Здравствуйте, спасибо за обращение в EVO Admissions! "
                "Чтобы подобрать подходящие варианты, расскажите, пожалуйста, "
                "какие страны для обучения вы рассматриваете."
            ),
        },
    ]

    entries = draft_knowledge_entries_from_turns(turns)

    assert len(entries) == 1
    assert entries[0]["question"] == "Какие страны для обучения вы рассматриваете?"
    assert "спасибо за обращение" in entries[0]["answer"]
    assert "country" in entries[0]["tags"]


def test_cli_turns_meta_reports_counts_without_chat_text() -> None:
    turns = [
        {"role": "customer", "text": "Какие документы нужны? [phone]"},
        {"role": "answerer", "text": "Отправьте документы на [email] или [link]"},
    ]
    entries = draft_knowledge_entries_from_turns(turns)

    meta = draft_turns_meta(turns, entries)

    assert meta["source_turns"] == 2
    assert meta["draft_count"] == 1
    assert meta["redactions"] == {"phones": 1, "emails": 1, "links": 1}
    rendered = json.dumps(meta, ensure_ascii=False)
    assert "Какие документы" not in rendered
    assert "Отправьте" not in rendered


def test_cli_draft_meta_reports_counts_without_chat_text() -> None:
    transcript = (
        "Клиент: Какие документы нужны? +996 700 111 222\n"
        "Менеджер: Отправьте документы на test@example.com или https://example.com\n"
    )
    entries = draft_knowledge_entries(transcript)

    meta = draft_knowledge_meta(transcript, entries)

    assert meta["source_lines"] == 2
    assert meta["draft_count"] == 1
    assert meta["redactions"] == {"phones": 1, "emails": 1, "links": 1}
    rendered = json.dumps(meta, ensure_ascii=False)
    assert "+996" not in rendered
    assert "test@example.com" not in rendered
    assert "Какие документы" not in rendered


def test_cli_review_warns_on_redaction_markers_without_blocking() -> None:
    report = review_knowledge_entries(
        [
            {
                "question": "Какие документы нужны?",
                "answer": "Обычно нужны паспорт, аттестат и [phone] для связи.",
            }
        ]
    )

    assert report["ok"] is True
    assert report["warning_entries"] == 1
    assert report["issues"][0]["warnings"] == ["contains_redaction_marker"]


def test_cli_review_warns_on_redaction_markers_in_metadata() -> None:
    report = review_knowledge_entries(
        [
            {
                "source": "amo_browser",
                "external_id": "docs-[phone]",
                "question": "Какие документы нужны?",
                "answer": "Обычно нужны паспорт, аттестат и транскрипт.",
                "tags": ["documents", "[link]"],
            }
        ]
    )

    assert report["ok"] is True
    assert report["warning_entries"] == 1
    assert report["issues"][0]["warnings"] == ["contains_redaction_marker"]


def test_cli_writes_draft_knowledge_json(tmp_path: Path) -> None:
    transcript = tmp_path / "chat.txt"
    output = tmp_path / "draft.json"
    transcript.write_text(
        "Клиент: Какие документы нужны?\n"
        "Менеджер: Обычно нужны паспорт, аттестат и транскрипт.\n",
        encoding="utf-8",
    )

    exit_code = draft_knowledge_main([str(transcript), "--output", str(output)])
    payload = json.loads(output.read_text(encoding="utf-8"))

    assert exit_code == 0
    assert payload["entries"][0]["question"] == "Какие документы нужны?"


def test_cli_writes_draft_knowledge_from_turns_json(tmp_path: Path) -> None:
    turns_path = tmp_path / "turns.json"
    output = tmp_path / "draft.json"
    turns_path.write_text(
        json.dumps(
            {
                "turns": [
                    {"role": "customer", "text": "Какие документы нужны?"},
                    {"role": "answerer", "text": "Обычно нужны паспорт, аттестат и транскрипт."},
                ]
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    exit_code = draft_knowledge_main(["--turns-json", str(turns_path), "--output", str(output)])
    payload = json.loads(output.read_text(encoding="utf-8"))

    assert exit_code == 0
    assert payload["meta"]["source_turns"] == 2
    assert payload["entries"][0]["question"] == "Какие документы нужны?"


def test_cli_draft_skips_customer_details_between_question_and_answer() -> None:
    transcript = """
Клиент: Какие документы нужны для поступления?
Клиент: Меня зовут Айжан, мне 17 лет, я учусь в школе №5
Менеджер: Обычно нужны паспорт, аттестат, транскрипт и языковой сертификат.
"""

    entries = draft_knowledge_entries(transcript)

    assert len(entries) == 1
    assert "Айжан" not in entries[0]["answer"]
    assert "школе №5" not in entries[0]["answer"]
    assert entries[0]["answer"] == "Обычно нужны паспорт, аттестат, транскрипт и языковой сертификат."


def test_cli_draft_accepts_common_staff_labels() -> None:
    transcript = """
Клиент: Помогаете с визой?
Консультант EVO: Мы помогаем подготовить документы, но решение принимает консульство.
Клиент: Где посмотреть сайт?
Сотрудник: Детали можно обсудить с менеджером, ссылка [link] не нужна в базе.
"""

    entries = draft_knowledge_entries(transcript)

    assert len(entries) == 2
    assert entries[0]["answer"] == "Мы помогаем подготовить документы, но решение принимает консульство."
    assert entries[1]["answer"] == "Детали можно обсудить с менеджером, ссылка [link] не нужна в базе."


def test_cli_draft_external_ids_are_content_stable_not_sequential() -> None:
    first = draft_knowledge_entries(
        "Клиент: Какие документы нужны?\nМенеджер: Обычно нужны паспорт и аттестат.\n"
    )
    second = draft_knowledge_entries(
        "Клиент: Сколько стоит обучение?\n"
        "Менеджер: Стоимость зависит от страны, университета и программы.\n"
    )

    assert first[0]["external_id"] != second[0]["external_id"]
    assert first[0]["external_id"].startswith("amo_browser-draft-")
    assert second[0]["external_id"].startswith("amo_browser-draft-")
