from __future__ import annotations

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
