from __future__ import annotations

import re
from pathlib import Path

import pytest

from evo_lead_agent.config import load_settings


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    keys = [
        "EVO_AGENT_ADMIN_API_KEY",
        "EVO_AGENT_OUTBOUND_ENABLED",
        "GEMINI_API_KEY",
        "GOOGLE_API_KEY",
        "EVO_AGENT_GEMINI_API_KEY",
        "EVO_AGENT_GEMINI_MODEL",
        "EVO_AGENT_WAHA_SESSION",
    ]
    for key in keys:
        monkeypatch.delenv(key, raising=False)
    yield
    for key in keys:
        monkeypatch.delenv(key, raising=False)


def test_load_settings_reads_local_dotenv(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    (tmp_path / ".env").write_text(
        "\n".join(
            [
                "EVO_AGENT_ADMIN_API_KEY=local-admin-from-dotenv",
                "EVO_AGENT_OUTBOUND_ENABLED=true",
                "GEMINI_API_KEY=local-gemini",
                "EVO_AGENT_GEMINI_MODEL=gemini-custom",
            ]
        ),
        encoding="utf-8",
    )

    settings = load_settings()

    assert settings.admin_api_key == "local-admin-from-dotenv"
    assert settings.outbound_enabled is True
    assert settings.gemini_api_key == "local-gemini"
    assert settings.gemini_model == "gemini-custom"


def test_load_settings_keeps_explicit_environment_over_dotenv(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("EVO_AGENT_ADMIN_API_KEY", "explicit-admin")
    (tmp_path / ".env").write_text(
        "EVO_AGENT_ADMIN_API_KEY=local-admin-from-dotenv\n",
        encoding="utf-8",
    )

    settings = load_settings()

    assert settings.admin_api_key == "explicit-admin"


def test_load_settings_accepts_google_api_key_for_gemini(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("GOOGLE_API_KEY", "google-gemini-key")
    monkeypatch.setenv("GEMINI_API_KEY", "gemini-key")

    settings = load_settings()

    assert settings.gemini_api_key == "google-gemini-key"
    assert settings.gemini_model == "gemini-3.5-flash"


def test_load_settings_defaults_to_frozen_with_worker_disabled(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)

    settings = load_settings()

    assert settings.frozen is True
    assert settings.worker_enabled is False


def test_load_settings_uses_only_the_canonical_platform_waha_session(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.chdir(tmp_path)

    assert load_settings().waha_session_name == "evo-inbox"

    for noncanonical_session in ("crm_primary", "evo-inbox ", ""):
        monkeypatch.setenv("EVO_AGENT_WAHA_SESSION", noncanonical_session)
        with pytest.raises(
            ValueError,
            match="EVO_AGENT_WAHA_SESSION must be exactly evo-inbox",
        ):
            load_settings()


def test_forward_runtime_examples_do_not_reactivate_the_lead_agent_webhook() -> None:
    repository_root = Path(__file__).resolve().parents[2]
    local_env = (repository_root / "evo-lead-agent/.env.example").read_text()
    deploy_env = (repository_root / "deploy/env.lead-agent.example").read_text()
    local_compose = (repository_root / "evo-lead-agent/docker-compose.yml").read_text()
    production_compose = (repository_root / "docker-compose.prod.yml").read_text()
    staging_compose = (repository_root / "docker-compose.staging.yml").read_text()
    deploy_readme = (repository_root / "deploy/README.md").read_text()

    for environment_example in (local_env, deploy_env):
        assert re.search(r"^EVO_AGENT_WAHA_SESSION=evo-inbox$", environment_example, re.M)
        assert re.search(r"^EVO_AGENT_WAHA_WEBHOOK_SECRET=$", environment_example, re.M)
        assert re.search(r"^EVO_AGENT_WAHA_WEBHOOK_URL=$", environment_example, re.M)

    assert "${EVO_AGENT_WAHA_SESSION:-evo-inbox}" in local_compose
    for active_compose in (production_compose, staging_compose):
        assert "EVO_AGENT_WAHA_SESSION: evo-inbox" not in active_compose
        assert "evo-lead-agent" not in active_compose
    assert "/api/internal/platform-messaging/waha/events" in deploy_readme
    assert "EVO_PLATFORM_WAHA_WEBHOOK_HMAC_SECRET" in deploy_readme
    assert "EVO_AGENT_WAHA_WEBHOOK_URL=http://evo-lead-agent" not in deploy_readme
