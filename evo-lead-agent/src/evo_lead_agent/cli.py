from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import re
import time
from pathlib import Path
from typing import Any, Sequence

import httpx
from dotenv import find_dotenv

from .config import load_settings
from .preflight import run_preflight
from .readiness import build_readiness_report
from .store import Store

_PHONE_RE = re.compile(r"(?<!\d)(?:\+?\d[\d\s().-]{7,}\d)(?!\d)")
_EMAIL_RE = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")
_URL_RE = re.compile(r"https?://\S+|\bwww\.\S+", re.IGNORECASE)
_SPEAKER_RE = re.compile(r"^(?P<speaker>[^:：]{1,40})[:：]\s*(?P<text>.+)$")
_NOISE_PREFIXES = (
    "amoCRM:",
    "EVO Admissions",
    "Рабочий стол",
    "Сделки",
    "imBox",
    "Wazzup",
    "ChatApp",
)
_REDACTION_LABELS = ("[phone]", "[email]", "[link]")
_QUESTION_STARTERS = (
    "какие ",
    "какой ",
    "какая ",
    "как ",
    "сколько ",
    "можно ",
    "помогаете ",
    "нужен ",
    "нужна ",
    "нужны ",
    "что ",
    "где ",
    "когда ",
    "do ",
    "does ",
    "how ",
    "what ",
    "can ",
)


def load_knowledge_entries(path: Path) -> list[dict[str, Any]]:
    if path.suffix.lower() == ".jsonl":
        return _load_jsonl_entries(path)

    with path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    return _entries_from_payload(payload)


def import_knowledge_main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="evo-lead-agent-import-knowledge",
        description="Import curated EVO Admissions Q/A knowledge into the local lead-agent SQLite DB.",
    )
    parser.add_argument("path", type=Path, help="Path to a JSON or JSONL file with curated entries.")
    parser.add_argument(
        "--db",
        type=Path,
        default=None,
        help="SQLite DB path. Defaults to EVO_AGENT_DB_PATH or data/evo-lead-agent.db.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate the curated file and print a report without writing to SQLite.",
    )
    parser.add_argument("--pretty", action="store_true", help="Pretty-print JSON output.")
    args = parser.parse_args(argv)

    settings = load_settings()
    database_path = args.db or settings.database_path
    entries = load_knowledge_entries(args.path)
    review = review_knowledge_entries(entries)
    if args.dry_run or not review["ok"]:
        print(
            json.dumps(
                {
                    "ok": review["ok"],
                    "dry_run": args.dry_run,
                    "database_path": str(database_path),
                    **review,
                },
                ensure_ascii=False,
                indent=2 if args.pretty else None,
                sort_keys=True,
            )
        )
        return 0 if review["ok"] else 1

    imported = Store(database_path).upsert_knowledge_entries(entries)
    print(
        json.dumps(
            {
                "ok": True,
                "imported": imported,
                "database_path": str(database_path),
                "review": review,
            },
            ensure_ascii=False,
            indent=2 if args.pretty else None,
            sort_keys=True,
        )
    )
    return 0


def readiness_main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="evo-lead-agent-readiness",
        description="Check EVO lead-agent config readiness without printing secret values.",
    )
    parser.add_argument(
        "--db",
        type=Path,
        default=None,
        help="SQLite DB path. Defaults to EVO_AGENT_DB_PATH or data/evo-lead-agent.db.",
    )
    parser.add_argument("--pretty", action="store_true", help="Pretty-print JSON output.")
    args = parser.parse_args(argv)

    settings = load_settings()
    database_path = args.db or settings.database_path
    report = build_readiness_report(settings, Store(database_path).knowledge_count())
    print(json.dumps(report, ensure_ascii=False, indent=2 if args.pretty else None, sort_keys=True))
    return 0 if report["ok"] else 1


def preflight_main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="evo-lead-agent-preflight",
        description="Run non-destructive live-service checks for EVO lead-agent.",
    )
    parser.add_argument(
        "--db",
        type=Path,
        default=None,
        help="SQLite DB path. Defaults to EVO_AGENT_DB_PATH or data/evo-lead-agent.db.",
    )
    parser.add_argument("--pretty", action="store_true", help="Pretty-print JSON output.")
    args = parser.parse_args(argv)

    settings = load_settings()
    database_path = args.db or settings.database_path
    report = _run_async(run_preflight(settings, Store(database_path).knowledge_count()))
    print(json.dumps(report, ensure_ascii=False, indent=2 if args.pretty else None, sort_keys=True))
    return 0 if report["ok"] else 1


def env_audit_main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="evo-lead-agent-env-audit",
        description="Audit local lead-agent environment readiness without network calls.",
    )
    parser.add_argument(
        "--db",
        type=Path,
        default=None,
        help="SQLite DB path. Defaults to EVO_AGENT_DB_PATH or data/evo-lead-agent.db.",
    )
    parser.add_argument("--pretty", action="store_true", help="Pretty-print JSON output.")
    args = parser.parse_args(argv)

    settings = load_settings()
    database_path = args.db or settings.database_path
    store = Store(database_path)
    knowledge_count = store.knowledge_count()
    readiness = build_readiness_report(settings, knowledge_count)
    dotenv_path = find_dotenv(usecwd=True)
    missing_for_live_preflight = _missing_for_live_preflight(readiness)
    missing_for_waha_setup = _missing_for_waha_setup(settings)
    ready = {
        "local_smoke": bool(
            readiness["configured"]["admin_api"]
            and readiness["configured"]["waha_webhook"]
            and not settings.outbound_enabled
        ),
        "waha_setup": not missing_for_waha_setup,
        "receive_only_rollout": bool(readiness["ready"]["receive_only_rollout"]),
        "live_preflight": not missing_for_live_preflight,
        "ai_decision_review": bool(readiness["stages"]["ai_decision_review"]["ok"]),
        "live_whatsapp_outbound": bool(readiness["ready"]["live_whatsapp_outbound"]),
    }
    report = {
        "ok": ready["receive_only_rollout"],
        "env": readiness["env"],
        "dotenv_loaded": bool(dotenv_path),
        "knowledge_count": knowledge_count,
        "configured": readiness["configured"],
        "safety": readiness["safety"],
        "ready": ready,
        "missing": {
            "local_smoke": readiness["stages"]["waha_inbound_capture"]["missing"]
            + ([] if readiness["configured"]["admin_api"] else ["EVO_AGENT_ADMIN_API_KEY"]),
            "waha_setup": missing_for_waha_setup,
            "live_preflight": missing_for_live_preflight,
            "ai_decision_review": readiness["stages"]["ai_decision_review"]["missing"],
            "receive_only_rollout": readiness["stages"]["receive_only_rollout"]["missing"],
            "live_whatsapp_outbound": readiness["stages"]["live_whatsapp_outbound"]["missing"],
        },
        "warnings": readiness["warnings"],
        "next_action": _next_env_audit_action(ready, readiness["warnings"]),
    }
    print(json.dumps(report, ensure_ascii=False, indent=2 if args.pretty else None, sort_keys=True))
    return 0 if report["ok"] else 1


def smoke_waha_webhook_main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="evo-lead-agent-smoke-waha-webhook",
        description="Send a signed WAHA-shaped inbound message to a running local lead-agent service.",
    )
    parser.add_argument("--base-url", default="http://127.0.0.1:8088", help="Lead-agent base URL.")
    parser.add_argument("--secret", default=None, help="WAHA webhook HMAC secret. Defaults to settings.")
    parser.add_argument("--session", default=None, help="WAHA session name. Defaults to settings.")
    parser.add_argument("--phone", default="+15551234567", help="Direct-message phone number for the smoke payload.")
    parser.add_argument(
        "--message",
        default="Smoke test: signed inbound webhook capture.",
        help="Inbound message body for the smoke payload. Do not use real customer text.",
    )
    parser.add_argument(
        "--provider-message-id",
        default=None,
        help="Provider message id. Defaults to a generated smoke id.",
    )
    parser.add_argument("--timeout", type=float, default=10.0, help="HTTP timeout in seconds.")
    parser.add_argument("--pretty", action="store_true", help="Pretty-print JSON output.")
    args = parser.parse_args(argv)

    settings = load_settings()
    secret = args.secret or settings.waha_webhook_secret
    if not secret:
        print(json.dumps({"ok": False, "error": "waha_webhook_secret_required"}))
        return 2

    provider_message_id = args.provider_message_id or f"smoke-{int(time.time())}"
    try:
        payload = build_smoke_waha_payload(
            phone=args.phone,
            message=args.message,
            provider_message_id=provider_message_id,
            session=args.session or settings.waha_session_name,
        )
    except ValueError as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, sort_keys=True))
        return 2
    raw_body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    signature = hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha512).hexdigest()
    url = f"{args.base_url.rstrip('/')}/webhooks/waha"

    try:
        response = httpx.post(
            url,
            content=raw_body,
            headers={
                "Content-Type": "application/json",
                "X-Webhook-Hmac": signature,
                "X-Webhook-Hmac-Algorithm": "sha512",
            },
            timeout=args.timeout,
        )
        response_payload = response.json() if response.content else {}
    except (httpx.HTTPError, json.JSONDecodeError) as exc:
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": "request_failed",
                    "detail": type(exc).__name__,
                },
                sort_keys=True,
            )
        )
        return 1

    result = _compact_webhook_check(
        {"status_code": response.status_code, "payload": response_payload},
        provider_message_id,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2 if args.pretty else None, sort_keys=True))
    return 0 if result["ok"] else 1


def local_smoke_main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="evo-lead-agent-local-smoke",
        description="Verify a running local Docker lead-agent service without live outbound.",
    )
    parser.add_argument("--base-url", default="http://127.0.0.1:8088", help="Lead-agent base URL.")
    parser.add_argument("--admin-key", default=None, help="Admin API key. Defaults to settings.")
    parser.add_argument(
        "--webhook-secret",
        default=None,
        help="WAHA webhook HMAC secret. Defaults to settings.",
    )
    parser.add_argument("--session", default=None, help="WAHA session name. Defaults to settings.")
    parser.add_argument("--phone", default="+15551234567", help="Direct-message phone number.")
    parser.add_argument(
        "--message",
        default="Smoke test: signed inbound webhook capture.",
        help="Inbound message body for the local smoke payload. Do not use real customer text.",
    )
    parser.add_argument(
        "--min-knowledge-count",
        type=int,
        default=1,
        help="Minimum expected knowledge entries, usually from the starter pack.",
    )
    parser.add_argument("--timeout", type=float, default=10.0, help="HTTP timeout in seconds.")
    parser.add_argument("--pretty", action="store_true", help="Pretty-print JSON output.")
    args = parser.parse_args(argv)

    settings = load_settings()
    admin_key = args.admin_key or settings.admin_api_key
    webhook_secret = args.webhook_secret or settings.waha_webhook_secret
    missing = []
    if not admin_key:
        missing.append("EVO_AGENT_ADMIN_API_KEY")
    if not webhook_secret:
        missing.append("EVO_AGENT_WAHA_WEBHOOK_SECRET")
    if missing:
        print(json.dumps({"ok": False, "error": "required_secret_missing", "missing": missing}))
        return 2

    try:
        with httpx.Client(timeout=args.timeout) as client:
            report = run_local_smoke(
                client=client,
                base_url=args.base_url,
                admin_key=admin_key,
                webhook_secret=webhook_secret,
                session=args.session or settings.waha_session_name,
                phone=args.phone,
                message=args.message,
                min_knowledge_count=args.min_knowledge_count,
            )
    except ValueError as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, sort_keys=True))
        return 2

    print(json.dumps(report, ensure_ascii=False, indent=2 if args.pretty else None, sort_keys=True))
    return 0 if report["ok"] else 1


def waha_setup_main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="evo-lead-agent-waha-setup",
        description="Create or update a WAHA session webhook for the EVO lead-agent.",
    )
    parser.add_argument("--base-url", default=None, help="WAHA base URL. Defaults to settings.")
    parser.add_argument("--api-key", default=None, help="WAHA API key. Defaults to settings.")
    parser.add_argument("--session", default=None, help="WAHA session name. Defaults to settings.")
    parser.add_argument(
        "--webhook-url",
        default=os.getenv("EVO_AGENT_WAHA_WEBHOOK_URL"),
        help="URL WAHA can reach for this agent's /webhooks/waha endpoint.",
    )
    parser.add_argument(
        "--webhook-secret",
        default=None,
        help="WAHA webhook HMAC secret. Defaults to settings.",
    )
    parser.add_argument(
        "--events",
        default="message,session.status",
        help="Comma-separated WAHA events to subscribe to.",
    )
    parser.add_argument("--no-start", action="store_true", help="Configure webhook without starting session.")
    parser.add_argument("--dry-run", action="store_true", help="Validate setup config without calling WAHA.")
    parser.add_argument(
        "--qr-output",
        type=Path,
        default=None,
        help="Optional path for saving a QR PNG after starting the session.",
    )
    parser.add_argument("--timeout", type=float, default=20.0, help="HTTP timeout in seconds.")
    parser.add_argument("--pretty", action="store_true", help="Pretty-print JSON output.")
    args = parser.parse_args(argv)

    settings = load_settings()
    base_url = args.base_url or settings.waha_base_url
    api_key = args.api_key or settings.waha_api_key
    session = args.session or settings.waha_session_name
    webhook_secret = args.webhook_secret or settings.waha_webhook_secret
    events = normalize_waha_events([event.strip() for event in args.events.split(",") if event.strip()])
    missing = []
    if not base_url:
        missing.append("EVO_AGENT_WAHA_BASE_URL")
    if not api_key:
        missing.append("EVO_AGENT_WAHA_API_KEY")
    if not args.webhook_url:
        missing.append("EVO_AGENT_WAHA_WEBHOOK_URL or --webhook-url")
    if not webhook_secret:
        missing.append("EVO_AGENT_WAHA_WEBHOOK_SECRET")
    if not events:
        missing.append("--events")
    if missing:
        print(json.dumps({"ok": False, "error": "required_config_missing", "missing": missing}))
        return 2

    if args.dry_run:
        build_waha_session_payload(
            session=session,
            webhook_url=args.webhook_url,
            webhook_secret=webhook_secret,
            events=events,
        )
        report = {
            "ok": True,
            "dry_run": True,
            "session": session,
            "events": events,
            "webhook": {"configured": True, "hmac": "configured"},
            "start": {"requested": not args.no_start},
            "qr": {"requested": args.qr_output is not None},
            "next_action": "run_waha_setup_without_dry_run_against_real_waha",
        }
        print(json.dumps(report, ensure_ascii=False, indent=2 if args.pretty else None, sort_keys=True))
        return 0

    try:
        with httpx.Client(timeout=args.timeout) as client:
            report = run_waha_setup(
                client=client,
                base_url=base_url,
                api_key=api_key,
                session=session,
                webhook_url=args.webhook_url,
                webhook_secret=webhook_secret,
                events=events,
                start=not args.no_start,
                qr_output=args.qr_output,
            )
    except ValueError as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, sort_keys=True))
        return 2

    print(json.dumps(report, ensure_ascii=False, indent=2 if args.pretty else None, sort_keys=True))
    return 0 if report["ok"] else 1


def run_waha_setup(
    *,
    client: httpx.Client,
    base_url: str,
    api_key: str,
    session: str,
    webhook_url: str,
    webhook_secret: str,
    events: list[str],
    start: bool,
    qr_output: Path | None,
) -> dict[str, Any]:
    base = base_url.rstrip("/")
    headers = {"X-Api-Key": api_key, "Content-Type": "application/json"}
    session_body = build_waha_session_payload(
        session=session,
        webhook_url=webhook_url,
        webhook_secret=webhook_secret,
        events=events,
        start=start,
    )

    existing = _client_request_json(
        client,
        "GET",
        f"{base}/api/sessions/{session}",
        headers={"X-Api-Key": api_key},
    )
    existing_status = existing["status_code"]
    if existing_status == 404:
        configure = _client_request_json(
            client,
            "POST",
            f"{base}/api/sessions/",
            json_body=session_body,
            headers=headers,
        )
        configure_action = "created"
    elif existing_status is not None and existing_status < 400:
        configure = _client_request_json(
            client,
            "POST",
            f"{base}/api/sessions/{session}/",
            json_body=session_body,
            headers=headers,
        )
        configure_action = "updated"
    else:
        return {
            "ok": False,
            "session": session,
            "events": events,
            "webhook": {"configured": False, "hmac": "configured"},
            "configure": {
                "action": "check_session",
                "ok": False,
                "status_code": existing_status,
                "reason": existing.get("error") or "session_lookup_failed",
            },
            "start": {"requested": start, "ok": None, "status_code": None},
            "qr": {"requested": qr_output is not None, "ok": None, "status_code": None, "saved": None},
            "next_action": "fix_waha_session_setup",
        }

    configure_ok = configure["status_code"] is not None and configure["status_code"] < 400
    start_check = {"requested": start, "ok": None, "status_code": None}
    if configure_ok and start:
        start_response = _client_request_json(
            client,
            "POST",
            f"{base}/api/sessions/{session}/start",
            json_body={},
            headers=headers,
        )
        start_check = {
            "requested": True,
            "ok": start_response["status_code"] is not None and start_response["status_code"] < 400,
            "status_code": start_response["status_code"],
        }

    qr_check = {"requested": qr_output is not None, "ok": None, "status_code": None, "saved": None}
    if qr_output is not None and (start_check["ok"] is True or not start):
        qr_check = _save_waha_qr_png(
            client=client,
            url=f"{base}/api/{session}/auth/qr",
            api_key=api_key,
            output=qr_output,
        )

    ok = configure_ok and (start_check["ok"] is not False) and (qr_check["ok"] is not False)
    return {
        "ok": ok,
        "session": session,
        "events": events,
        "webhook": {"configured": configure_ok, "hmac": "configured"},
        "configure": {
            "action": configure_action,
            "ok": configure_ok,
            "status_code": configure["status_code"],
        },
        "start": start_check,
        "qr": qr_check,
        "next_action": _waha_setup_next_action(ok, qr_check, start_check),
    }


def run_local_smoke(
    *,
    client: httpx.Client,
    base_url: str,
    admin_key: str,
    webhook_secret: str,
    session: str,
    phone: str,
    message: str,
    min_knowledge_count: int,
) -> dict[str, Any]:
    base = base_url.rstrip("/")
    checks: dict[str, Any] = {}
    warnings: list[str] = []

    health_response = _client_request_json(client, "GET", f"{base}/health")
    checks["health"] = _compact_health_check(health_response, min_knowledge_count)
    if checks["health"].get("outbound_enabled") is True:
        warnings.append("outbound_enabled_must_be_false_for_local_smoke")
    if checks["health"].get("knowledge_count", 0) < min_knowledge_count:
        warnings.append("knowledge_count_below_minimum")

    admin_headers = {"X-Evo-Agent-Admin-Key": admin_key}
    readiness_response = _client_request_json(
        client,
        "GET",
        f"{base}/admin/readiness",
        headers=admin_headers,
    )
    checks["readiness"] = _compact_readiness_check(readiness_response)

    preflight_response = _client_request_json(
        client,
        "GET",
        f"{base}/admin/preflight",
        headers=admin_headers,
    )
    checks["preflight"] = _compact_preflight_check(preflight_response)

    provider_message_id = f"local-smoke-{int(time.time())}"
    payload = build_smoke_waha_payload(
        phone=phone,
        message=message,
        provider_message_id=provider_message_id,
        session=session,
    )
    raw_body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    signature = hmac.new(webhook_secret.encode("utf-8"), raw_body, hashlib.sha512).hexdigest()
    webhook_response = _client_request_json(
        client,
        "POST",
        f"{base}/webhooks/waha",
        content=raw_body,
        headers={
            "Content-Type": "application/json",
            "X-Webhook-Hmac": signature,
            "X-Webhook-Hmac-Algorithm": "sha512",
        },
    )
    checks["signed_webhook"] = _compact_webhook_check(webhook_response, provider_message_id)

    required_ok = (
        checks["health"]["ok"]
        and checks["readiness"]["reachable"]
        and checks["preflight"]["reachable"]
        and checks["signed_webhook"]["ok"]
        and not warnings
    )
    return {
        "ok": required_ok,
        "base_url": base,
        "checks": checks,
        "warnings": warnings,
        "next_action": "configure_real_env_and_run_live_preflight" if required_ok else "fix_local_smoke_failure",
    }


def _missing_for_live_preflight(readiness: dict[str, Any]) -> list[str]:
    return list(readiness["stages"]["receive_only_rollout"]["missing"])


def _missing_for_waha_setup(settings: Any) -> list[str]:
    missing = []
    if not settings.waha_base_url:
        missing.append("EVO_AGENT_WAHA_BASE_URL")
    if not settings.waha_api_key:
        missing.append("EVO_AGENT_WAHA_API_KEY")
    if not settings.waha_session_name:
        missing.append("EVO_AGENT_WAHA_SESSION")
    if not settings.waha_webhook_secret:
        missing.append("EVO_AGENT_WAHA_WEBHOOK_SECRET")
    if not _optional_env("EVO_AGENT_WAHA_WEBHOOK_URL"):
        missing.append("EVO_AGENT_WAHA_WEBHOOK_URL")
    return missing


def _optional_env(name: str) -> str | None:
    value = os.getenv(name)
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


def _next_env_audit_action(ready: dict[str, bool], warnings: list[str]) -> str:
    for name in (
        "local_smoke",
        "waha_setup",
        "live_preflight",
        "receive_only_rollout",
    ):
        if not ready[name]:
            return f"configure_{name}"
    if warnings:
        return f"review_warning:{warnings[0]}"
    return "ready_for_receive_only_rollout"


def draft_knowledge_main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="evo-lead-agent-draft-knowledge",
        description="Draft generic Q/A knowledge entries from copied amoCRM chat text or structured turns.",
    )
    parser.add_argument(
        "transcript",
        type=Path,
        nargs="?",
        help="Path to a copied amoCRM/imBox text file. Omit when using --turns-json.",
    )
    parser.add_argument(
        "--turns-json",
        type=Path,
        default=None,
        help="Path to structured JSON with turns: [{role: customer|answerer, text: ...}].",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=None,
        help="Write draft JSON here. Defaults to stdout.",
    )
    parser.add_argument("--source", default="amo_browser", help="Knowledge source label.")
    parser.add_argument("--language", default="ru", help="Language code for generated draft entries.")
    parser.add_argument("--max-entries", type=int, default=25, help="Maximum draft entries to emit.")
    parser.add_argument(
        "--min-answer-chars",
        type=int,
        default=12,
        help="Minimum answer-line length to include in a draft entry.",
    )
    args = parser.parse_args(argv)

    if args.turns_json is not None:
        turns = load_turns(args.turns_json)
        entries = draft_knowledge_entries_from_turns(
            turns,
            source=args.source,
            language=args.language,
            max_entries=args.max_entries,
            min_answer_chars=args.min_answer_chars,
        )
        payload = {"meta": draft_turns_meta(turns, entries), "entries": entries}
    else:
        if args.transcript is None:
            parser.error("transcript path is required unless --turns-json is provided")
        transcript = args.transcript.read_text(encoding="utf-8")
        entries = draft_knowledge_entries(
            transcript,
            source=args.source,
            language=args.language,
            max_entries=args.max_entries,
            min_answer_chars=args.min_answer_chars,
        )
        payload = {"meta": draft_knowledge_meta(transcript, entries), "entries": entries}
    rendered = json.dumps(payload, ensure_ascii=False, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered + "\n", encoding="utf-8")
    else:
        print(rendered)
    return 0


def draft_knowledge_entries(
    transcript: str,
    source: str = "amo_browser",
    language: str = "ru",
    max_entries: int = 25,
    min_answer_chars: int = 12,
) -> list[dict[str, Any]]:
    lines = [_sanitize_chat_line(line) for line in transcript.splitlines()]
    clean_lines = [line for line in lines if line and not _is_noise_line(line)]
    entries: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()

    for index, line in enumerate(clean_lines):
        if not _looks_like_question(line):
            continue
        answer = _next_answer(clean_lines, index + 1, min_answer_chars=min_answer_chars)
        if not answer:
            continue
        question = _strip_speaker(line)
        key = (question.casefold(), answer.casefold())
        if key in seen:
            continue
        seen.add(key)
        stable_id = hashlib.sha256(f"{question}\n{answer}".encode("utf-8")).hexdigest()[:16]
        entries.append(
            {
                "source": source,
                "external_id": f"{source}-draft-{stable_id}",
                "question": question,
                "answer": answer,
                "language": language,
                "tags": _guess_tags(f"{question} {answer}"),
            }
        )
        if len(entries) >= max(1, max_entries):
            break

    return entries


def load_turns(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    raw_turns = payload.get("turns") if isinstance(payload, dict) else payload
    if not isinstance(raw_turns, list):
        raise ValueError("turns_must_be_array")

    turns: list[dict[str, str]] = []
    for index, raw_turn in enumerate(raw_turns, start=1):
        if not isinstance(raw_turn, dict):
            raise ValueError(f"turn_must_be_object:{index}")
        role = raw_turn.get("role")
        text = raw_turn.get("text")
        if role not in {"customer", "answerer"}:
            raise ValueError(f"turn_role_invalid:{index}")
        if not isinstance(text, str):
            raise ValueError(f"turn_text_invalid:{index}")
        clean_text = _sanitize_chat_line(text)
        if clean_text:
            turns.append({"role": role, "text": clean_text})
    return turns


def draft_knowledge_entries_from_turns(
    turns: list[dict[str, str]],
    source: str = "amo_browser",
    language: str = "ru",
    max_entries: int = 25,
    min_answer_chars: int = 12,
) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for index, turn in enumerate(turns):
        if turn.get("role") != "customer":
            continue
        question = _question_clause(
            str(turn.get("text") or ""),
            require_question_starter=True,
            allow_embedded=True,
        )
        if not question:
            continue
        answer = _next_turn_answer(turns, index + 1, min_answer_chars=min_answer_chars)
        if not answer:
            continue
        key = (question.casefold(), answer.casefold())
        if key in seen:
            continue
        seen.add(key)
        stable_id = hashlib.sha256(f"{question}\n{answer}".encode("utf-8")).hexdigest()[:16]
        entries.append(
            {
                "source": source,
                "external_id": f"{source}-draft-{stable_id}",
                "question": question,
                "answer": answer,
                "language": language,
                "tags": _guess_tags(f"{question} {answer}"),
            }
        )
        if len(entries) >= max(1, max_entries):
            break
    return entries


def build_smoke_waha_payload(
    phone: str,
    message: str,
    provider_message_id: str,
    session: str = "crm_primary",
) -> dict[str, Any]:
    digits = re.sub(r"\D+", "", phone)
    if len(digits) < 8:
        raise ValueError("phone_must_have_at_least_8_digits")
    return {
        "event": "message",
        "session": session,
        "payload": {
            "id": provider_message_id,
            "from": f"{digits}@c.us",
            "fromMe": False,
            "body": message,
            "timestamp": int(time.time()),
            "_data": {"pushName": "Smoke Test"},
        },
    }


def build_waha_session_payload(
    *,
    session: str,
    webhook_url: str,
    webhook_secret: str,
    events: list[str],
    start: bool = True,
) -> dict[str, Any]:
    if not session.strip():
        raise ValueError("session_required")
    if not webhook_url.strip():
        raise ValueError("webhook_url_required")
    if not webhook_secret.strip():
        raise ValueError("webhook_secret_required")
    clean_events = [event.strip() for event in events if event.strip()]
    if not clean_events:
        raise ValueError("events_required")
    normalized_events = normalize_waha_events(clean_events)
    return {
        "name": session.strip(),
        "start": start,
        "config": {
            "webhooks": [
                {
                    "url": webhook_url.strip(),
                    "events": normalized_events,
                    "hmac": {"key": webhook_secret},
                    "retries": {
                        "policy": "linear",
                        "delaySeconds": 2,
                        "attempts": 4,
                    },
                }
            ]
        },
    }


def normalize_waha_events(events: list[str]) -> list[str]:
    clean_events = []
    seen = set()
    for event in events:
        normalized = event.strip()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        clean_events.append(normalized)
    required = ["message", "session.status"]
    return [*clean_events, *[event for event in required if event not in seen]]


def _client_request_json(
    client: httpx.Client,
    method: str,
    url: str,
    *,
    headers: dict[str, str] | None = None,
    content: bytes | None = None,
    json_body: dict[str, Any] | None = None,
) -> dict[str, Any]:
    try:
        if method == "POST":
            if json_body is None:
                response = client.post(url, content=content, headers=headers)
            else:
                response = client.post(url, json=json_body, headers=headers)
        else:
            response = client.get(url, headers=headers)
        payload = response.json() if response.content else {}
    except (httpx.HTTPError, json.JSONDecodeError) as exc:
        return {
            "status_code": None,
            "payload": {},
            "error": "request_failed",
            "detail": type(exc).__name__,
        }
    return {"status_code": response.status_code, "payload": payload}


def _save_waha_qr_png(
    *,
    client: httpx.Client,
    url: str,
    api_key: str,
    output: Path,
) -> dict[str, Any]:
    try:
        response = client.get(url, headers={"X-Api-Key": api_key, "Accept": "image/png"})
    except httpx.HTTPError as exc:
        return {
            "requested": True,
            "ok": False,
            "status_code": None,
            "saved": None,
            "error": "request_failed",
            "detail": type(exc).__name__,
        }
    ok = response.status_code < 400 and bool(response.content)
    if ok:
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(response.content)
    return {
        "requested": True,
        "ok": ok,
        "status_code": response.status_code,
        "saved": str(output) if ok else None,
    }


def _waha_setup_next_action(ok: bool, qr_check: dict[str, Any], start_check: dict[str, Any]) -> str:
    if not ok:
        return "fix_waha_session_setup"
    if qr_check.get("saved"):
        return "scan_qr_then_run_preflight"
    if start_check.get("requested"):
        return "fetch_or_scan_qr_then_run_preflight"
    return "start_session_then_run_preflight"


def _compact_health_check(response: dict[str, Any], min_knowledge_count: int) -> dict[str, Any]:
    payload = _response_payload(response)
    knowledge_count = _int_or_zero(payload.get("knowledge_count"))
    return {
        "ok": response["status_code"] == 200
        and bool(payload.get("ok"))
        and knowledge_count >= min_knowledge_count
        and payload.get("outbound_enabled") is False,
        "status_code": response["status_code"],
        "knowledge_count": knowledge_count,
        "min_knowledge_count": min_knowledge_count,
        "autoreply_enabled": bool(payload.get("autoreply_enabled")),
        "outbound_enabled": bool(payload.get("outbound_enabled")),
        "worker_enabled": bool(payload.get("worker_enabled")),
    }


def _compact_readiness_check(response: dict[str, Any]) -> dict[str, Any]:
    payload = _response_payload(response)
    return {
        "reachable": response["status_code"] == 200,
        "status_code": response["status_code"],
        "ok": bool(payload.get("ok")),
        "knowledge_count": payload.get("knowledge_count"),
        "ready": payload.get("ready") if isinstance(payload.get("ready"), dict) else {},
        "configured": payload.get("configured") if isinstance(payload.get("configured"), dict) else {},
        "safety": payload.get("safety") if isinstance(payload.get("safety"), dict) else {},
        "warnings": payload.get("warnings") if isinstance(payload.get("warnings"), list) else [],
        "next_action": payload.get("next_action"),
    }


def _compact_preflight_check(response: dict[str, Any]) -> dict[str, Any]:
    payload = _response_payload(response)
    raw_checks = payload.get("checks") if isinstance(payload.get("checks"), dict) else {}
    checks = {
        name: _compact_service_check(value)
        for name, value in raw_checks.items()
        if isinstance(name, str) and isinstance(value, dict)
    }
    return {
        "reachable": response["status_code"] == 200,
        "status_code": response["status_code"],
        "ok": bool(payload.get("ok")),
        "checks": checks,
    }


def _compact_service_check(check: dict[str, Any]) -> dict[str, Any]:
    compact: dict[str, Any] = {
        "status": check.get("status"),
        "reason": check.get("reason"),
        "missing": check.get("missing") if isinstance(check.get("missing"), list) else [],
    }
    if isinstance(check.get("session"), dict):
        session = check["session"]
        compact["session"] = {
            "name": session.get("name"),
            "status": session.get("status"),
            "found": session.get("found"),
        }
    if isinstance(check.get("account"), dict):
        account = check["account"]
        compact["account"] = {
            "id": account.get("id"),
            "name": account.get("name"),
            "subdomain": account.get("subdomain"),
        }
    return compact


def _compact_webhook_check(response: dict[str, Any], provider_message_id: str) -> dict[str, Any]:
    payload = _response_payload(response)
    return {
        "ok": response["status_code"] is not None
        and response["status_code"] < 400
        and bool(payload.get("accepted")),
        "status_code": response["status_code"],
        "provider_message_id": provider_message_id,
        "accepted": bool(payload.get("accepted")),
        "queued": bool(payload.get("queued")),
        "duplicate": bool(payload.get("duplicate")),
        "ignored": bool(payload.get("ignored")),
        "reason": payload.get("reason"),
        "processed": _compact_processed(payload.get("processed")),
    }


def _compact_processed(processed: object) -> dict[str, Any]:
    if not isinstance(processed, dict):
        return {}
    results = processed.get("results") if isinstance(processed.get("results"), list) else []
    return {
        "processed_count": _int_or_zero(processed.get("processed_count")),
        "results": [_compact_processed_result(result) for result in results if isinstance(result, dict)],
    }


def _compact_processed_result(result: dict[str, Any]) -> dict[str, Any]:
    return {
        "message_count": _int_or_zero(result.get("message_count")),
        "reply": result.get("reply"),
        "reason": result.get("reason"),
        "retryable": bool(result.get("retryable")),
        "handoff_required": bool(result.get("handoff_required")),
        "crm_sync": result.get("crm_sync"),
    }


def _response_payload(response: dict[str, Any]) -> dict[str, Any]:
    payload = response.get("payload")
    return payload if isinstance(payload, dict) else {}


def _int_or_zero(value: object) -> int:
    return value if isinstance(value, int) and not isinstance(value, bool) else 0


def draft_knowledge_meta(transcript: str, entries: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "source_sha256": hashlib.sha256(transcript.encode("utf-8")).hexdigest(),
        "source_lines": len(transcript.splitlines()),
        "draft_count": len(entries),
        "redactions": {
            "phones": len(_PHONE_RE.findall(transcript)),
            "emails": len(_EMAIL_RE.findall(transcript)),
            "links": len(_URL_RE.findall(transcript)),
        },
        "review_required": True,
    }


def draft_turns_meta(turns: list[dict[str, str]], entries: list[dict[str, Any]]) -> dict[str, Any]:
    rendered_turns = json.dumps(turns, ensure_ascii=False, sort_keys=True)
    return {
        "source_sha256": hashlib.sha256(rendered_turns.encode("utf-8")).hexdigest(),
        "source_turns": len(turns),
        "draft_count": len(entries),
        "redactions": {
            "phones": sum(_redaction_count(turn["text"], _PHONE_RE, "[phone]") for turn in turns),
            "emails": sum(_redaction_count(turn["text"], _EMAIL_RE, "[email]") for turn in turns),
            "links": sum(_redaction_count(turn["text"], _URL_RE, "[link]") for turn in turns),
        },
        "review_required": True,
    }


def review_knowledge_entries(entries: list[dict[str, Any]]) -> dict[str, Any]:
    results = [_review_knowledge_entry(entry, index) for index, entry in enumerate(entries, start=1)]
    importable = [result for result in results if result["importable"]]
    unsafe = [result for result in results if result["unsafe"]]
    skipped = [result for result in results if result["skipped"]]
    warnings = [
        result
        for result in results
        if result["warnings"] and result["importable"] and not result["unsafe"]
    ]
    return {
        "ok": not unsafe,
        "total_entries": len(entries),
        "importable_entries": len(importable),
        "skipped_entries": len(skipped),
        "unsafe_entries": len(unsafe),
        "warning_entries": len(warnings),
        "issues": [result for result in results if result["unsafe"] or result["warnings"]],
    }


def _load_jsonl_entries(path: Path) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line_number, raw_line in enumerate(handle, start=1):
            line = raw_line.strip()
            if not line:
                continue
            try:
                payload = json.loads(line)
            except json.JSONDecodeError as exc:
                raise ValueError(f"invalid_jsonl_line:{line_number}") from exc
            if not isinstance(payload, dict):
                raise ValueError(f"jsonl_line_must_be_object:{line_number}")
            entries.append(payload)
    return entries


def _entries_from_payload(payload: object) -> list[dict[str, Any]]:
    raw_entries = payload.get("entries") if isinstance(payload, dict) else payload
    if not isinstance(raw_entries, list):
        raise ValueError("entries_must_be_array")
    for index, entry in enumerate(raw_entries, start=1):
        if not isinstance(entry, dict):
            raise ValueError(f"entry_must_be_object:{index}")
    return raw_entries


def _sanitize_chat_line(line: str) -> str:
    text = line.strip()
    if not text:
        return ""
    text = _EMAIL_RE.sub("[email]", text)
    text = _URL_RE.sub("[link]", text)
    text = _PHONE_RE.sub("[phone]", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _is_noise_line(line: str) -> bool:
    return any(line.startswith(prefix) for prefix in _NOISE_PREFIXES)


def _looks_like_question(line: str) -> bool:
    return bool(_question_clause(line, require_question_starter=False, allow_embedded=False))


def _question_clause(
    line: str,
    require_question_starter: bool,
    allow_embedded: bool,
) -> str:
    text = _strip_speaker(line).strip()
    if not text:
        return ""
    lowered = text.casefold()
    if allow_embedded:
        matches = [
            lowered.find(starter)
            for starter in _QUESTION_STARTERS
            if lowered.find(starter) >= 0
        ]
    else:
        matches = [0 for starter in _QUESTION_STARTERS if lowered.startswith(starter)]
    if matches:
        question = text[min(matches) :].strip(" ,;:-")
        return question[:1].upper() + question[1:]
    if not require_question_starter and text.endswith("?"):
        return text
    return ""


def _next_answer(lines: list[str], start_index: int, min_answer_chars: int = 12) -> str | None:
    answer_parts: list[str] = []
    minimum = max(1, min_answer_chars)
    for line in lines[start_index : start_index + 6]:
        if _looks_like_question(line):
            break
        if not _is_answer_line(line):
            continue
        line = _strip_speaker(line)
        if len(line) < minimum:
            continue
        answer_parts.append(line)
        if len(" ".join(answer_parts)) >= 120:
            break
    answer = " ".join(answer_parts).strip()
    return answer or None


def _next_turn_answer(
    turns: list[dict[str, str]],
    start_index: int,
    min_answer_chars: int = 12,
) -> str | None:
    answer_parts: list[str] = []
    minimum = max(1, min_answer_chars)
    for turn in turns[start_index : start_index + 6]:
        text = str(turn.get("text") or "").strip()
        if turn.get("role") == "customer":
            if _looks_like_question(text) or answer_parts:
                break
            if not _looks_like_manager_answer_text(text):
                continue
        elif turn.get("role") != "answerer":
            continue
        if len(text) < minimum:
            continue
        answer_parts.append(text)
        if len(" ".join(answer_parts)) >= 120:
            break
    answer = " ".join(answer_parts).strip()
    return answer or None


def _looks_like_manager_answer_text(text: str) -> bool:
    lowered = text.casefold()
    if _looks_like_question(text):
        return False
    answer_markers = (
        "спасибо за обращение",
        "чтобы подобрать",
        "расскажите, пожалуйста",
        "обычно нужны",
        "стоимость зависит",
        "мы помогаем",
        "можем помочь",
        "подбер",
        "консультац",
        "для поступления",
    )
    return any(marker in lowered for marker in answer_markers)


def _strip_speaker(line: str) -> str:
    match = _SPEAKER_RE.match(line)
    if match and _speaker_kind(match.group("speaker")) in {"customer", "answerer"}:
        return match.group("text").strip()
    return line


def _is_answer_line(line: str) -> bool:
    match = _SPEAKER_RE.match(line)
    if match is None:
        return False
    return _speaker_kind(match.group("speaker")) == "answerer"


def _speaker_kind(speaker: str) -> str | None:
    normalized = speaker.casefold().strip()
    customer_markers = ("клиент", "client", "customer", "lead", "покупатель")
    answerer_markers = (
        "менеджер",
        "operator",
        "оператор",
        "manager",
        "salesbot",
        "бот",
        "admin",
        "evo",
        "сотрудник",
        "консультант",
        "специалист",
    )
    if any(marker in normalized for marker in answerer_markers):
        return "answerer"
    if any(marker in normalized for marker in customer_markers):
        return "customer"
    return None


def _guess_tags(text: str) -> list[str]:
    lowered = text.casefold()
    tags = []
    tag_rules = {
        "documents": ("документ", "паспорт", "аттестат", "транскрипт", "сертификат"),
        "price": ("стоим", "цена", "оплата", "сколько", "cost", "price"),
        "visa": ("виза", "visa", "консуль"),
        "country": ("стран", "страна", "европа", "канада", "сша", "usa", "uk", "турция"),
        "language": ("англий", "ielts", "toefl", "язык", "language"),
        "qualification": ("возраст", "образован", "класс", "бакалавр", "магистр"),
    }
    for tag, needles in tag_rules.items():
        if any(needle in lowered for needle in needles):
            tags.append(tag)
    return tags


def _review_knowledge_entry(entry: dict[str, Any], index: int) -> dict[str, Any]:
    question = _entry_text(entry, "question")
    answer = _entry_text(entry, "answer")
    external_id = _entry_text(entry, "external_id")
    source = _entry_text(entry, "source")
    language = _entry_text(entry, "language")
    tags = _entry_tags(entry)
    warnings: list[str] = []
    unsafe: list[str] = []

    if not question:
        warnings.append("missing_question")
    if not answer:
        warnings.append("missing_answer")
    persisted_text = [question, answer, external_id, source, language, *tags]
    if any(_contains_raw_sensitive_text(value) for value in persisted_text):
        unsafe.append("raw_phone_email_or_link")
    if any(_contains_redaction_marker(value) for value in persisted_text):
        warnings.append("contains_redaction_marker")

    return {
        "index": index,
        "external_id": external_id or None,
        "importable": bool(question and answer),
        "skipped": not bool(question and answer),
        "unsafe": unsafe,
        "warnings": warnings,
    }


def _entry_text(entry: dict[str, Any], field: str) -> str:
    value = entry.get(field)
    return value.strip() if isinstance(value, str) else ""


def _entry_tags(entry: dict[str, Any]) -> list[str]:
    raw_tags = entry.get("tags")
    if not isinstance(raw_tags, list):
        return []
    return [value.strip() for value in raw_tags if isinstance(value, str) and value.strip()]


def _contains_raw_sensitive_text(text: str) -> bool:
    return bool(_PHONE_RE.search(text) or _EMAIL_RE.search(text) or _URL_RE.search(text))


def _contains_redaction_marker(text: str) -> bool:
    lowered = text.casefold()
    return any(label in lowered for label in _REDACTION_LABELS)


def _redaction_count(text: str, pattern: re.Pattern[str], marker: str) -> int:
    return len(pattern.findall(text)) + text.casefold().count(marker)


if __name__ == "__main__":
    raise SystemExit(import_knowledge_main())


def _run_async(coro: Any) -> Any:
    import asyncio

    return asyncio.run(coro)
