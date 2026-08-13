#!/usr/bin/env python3
"""Export WAHA chats through the private lead-agent container.

The WAHA credential stays inside the remote container. The local side receives
only the owner-authorized archive stream and writes it to protected storage.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile
from typing import Any, BinaryIO


REMOTE_EXPORTER = r'''
import datetime
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

session = sys.argv[1]
chat_limit = int(sys.argv[2])
message_limit = int(sys.argv[3])
known = json.loads(__import__("base64").urlsafe_b64decode(sys.argv[4]).decode("utf-8"))
base_url = os.environ["EVO_AGENT_WAHA_BASE_URL"].rstrip("/")
api_key = os.environ["EVO_AGENT_WAHA_API_KEY"]
headers = {"X-Api-Key": api_key, "Accept": "application/json"}


def emit(value):
    print(json.dumps(value, ensure_ascii=False, separators=(",", ":")), flush=True)


def request_json(path, attempts=5):
    for attempt in range(attempts):
        try:
            request = urllib.request.Request(base_url + path, headers=headers)
            with urllib.request.urlopen(request, timeout=120) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            if error.code not in (429, 500, 502, 503, 504) or attempt + 1 == attempts:
                raise
        except (TimeoutError, urllib.error.URLError):
            if attempt + 1 == attempts:
                raise
        time.sleep(min(2 ** attempt, 16))


def serialized_id(value):
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        candidate = value.get("_serialized")
        if isinstance(candidate, str):
            return candidate
    raise ValueError("chat id has no serialized string")


version = request_json("/api/server/version")
session_info = request_json("/api/sessions/" + urllib.parse.quote(session, safe=""))
if session_info.get("status") != "WORKING":
    raise RuntimeError("WAHA session is not WORKING")

chats = []
offset = 0
while True:
    query = urllib.parse.urlencode({"limit": chat_limit, "offset": offset})
    batch = request_json("/api/" + urllib.parse.quote(session, safe="") + "/chats?" + query)
    if not isinstance(batch, list):
        raise TypeError("WAHA chats response is not a list")
    chats.extend(batch)
    if len(batch) < chat_limit:
        break
    offset += chat_limit

emit({
    "type": "header",
    "exported_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "session": session,
    "version": version.get("version"),
    "engine": version.get("engine"),
    "chat_count": len(chats),
})

exported = 0
skipped = 0
failed = 0
for chat in chats:
    try:
        chat_id = serialized_id(chat.get("id"))
        chat_hash = hashlib.sha256(chat_id.encode("utf-8")).hexdigest()
        last_message = chat.get("lastMessage") or {}
        last_timestamp = last_message.get("timestamp") or chat.get("timestamp") or 0
        previous = known.get(chat_hash) or {}
        if previous.get("last_message_timestamp") == last_timestamp:
            skipped += 1
            continue

        emit({
            "type": "chat_start",
            "chat_hash": chat_hash,
            "chat": chat,
            "last_message_timestamp": last_timestamp,
        })
        message_offset = 0
        message_count = 0
        while True:
            query = urllib.parse.urlencode({
                "limit": message_limit,
                "offset": message_offset,
                "downloadMedia": "false",
            })
            path = (
                "/api/" + urllib.parse.quote(session, safe="") + "/chats/"
                + urllib.parse.quote(chat_id, safe="") + "/messages?" + query
            )
            messages = request_json(path)
            if not isinstance(messages, list):
                raise TypeError("WAHA messages response is not a list")
            emit({"type": "message_page", "chat_hash": chat_hash, "messages": messages})
            message_count += len(messages)
            if len(messages) < message_limit:
                break
            message_offset += message_limit
        emit({
            "type": "chat_end",
            "chat_hash": chat_hash,
            "message_count": message_count,
            "last_message_timestamp": last_timestamp,
        })
        exported += 1
    except Exception as error:
        failed += 1
        emit({
            "type": "chat_error",
            "chat_hash": locals().get("chat_hash"),
            "error_type": type(error).__name__,
            "error": str(error)[:500],
        })

emit({"type": "summary", "exported": exported, "skipped": skipped, "failed": failed})
'''


SAFE_NAME = re.compile(r"^[A-Za-z0-9._-]+$")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Защищённая возобновляемая выгрузка истории WAHA",
    )
    parser.add_argument("--destination", type=Path, required=True)
    parser.add_argument("--ssh-host", default="hermes-vps")
    parser.add_argument("--container", default="evo-crm-lead-agent-1")
    parser.add_argument("--session", default="crm_primary")
    parser.add_argument("--chat-limit", type=int, default=100)
    parser.add_argument("--message-limit", type=int, default=100)
    return parser.parse_args()


def validate_args(args: argparse.Namespace) -> None:
    for label, value in (
        ("ssh host", args.ssh_host),
        ("container", args.container),
        ("session", args.session),
    ):
        if not SAFE_NAME.fullmatch(value):
            raise ValueError(f"unsafe {label}: {value!r}")
    for label, value in (("chat limit", args.chat_limit), ("message limit", args.message_limit)):
        if value < 1 or value > 500:
            raise ValueError(f"{label} must be between 1 and 500")


def atomic_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, temporary = tempfile.mkstemp(prefix=path.name + ".", suffix=".part", dir=path.parent)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(value, handle, ensure_ascii=False, indent=2, sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    except BaseException:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
        raise


def load_json(path: Path, fallback: Any) -> Any:
    if not path.exists():
        return fallback
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def message_identity(message: Any) -> str:
    if isinstance(message, dict) and "id" in message:
        return json.dumps(message["id"], ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(
        json.dumps(message, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()


class ChatWriter:
    def __init__(self, chats_dir: Path, event: dict[str, Any]):
        self.chat_hash = event["chat_hash"]
        self.final_path = chats_dir / f"{self.chat_hash}.jsonl"
        self.part_path = chats_dir / f"{self.chat_hash}.jsonl.part"
        self.handle = self.part_path.open("w", encoding="utf-8")
        os.chmod(self.part_path, 0o600)
        self.seen: set[str] = set()
        self.message_count = 0
        self.media_count = 0
        self.text_count = 0
        self.write({"тип": "метаданные чата", "данные": event["chat"]})

    def write(self, value: Any) -> None:
        self.handle.write(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n")

    def add_messages(self, messages: list[Any]) -> None:
        for message in messages:
            identity = message_identity(message)
            if identity in self.seen:
                continue
            self.seen.add(identity)
            if isinstance(message, dict):
                self.media_count += int(message.get("hasMedia") is True)
                self.text_count += int(bool(message.get("body")))
            self.write({"тип": "сообщение", "данные": message})
            self.message_count += 1

    def finish(self) -> tuple[Path, str]:
        self.handle.flush()
        os.fsync(self.handle.fileno())
        self.handle.close()
        os.replace(self.part_path, self.final_path)
        return self.final_path, file_sha256(self.final_path)

    def abort(self) -> None:
        if not self.handle.closed:
            self.handle.close()
        self.part_path.unlink(missing_ok=True)


def enforce_private_directory(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(path, 0o700)
    mode = stat.S_IMODE(path.stat().st_mode)
    if mode != 0o700:
        raise PermissionError(f"destination mode must be 0700, got {mode:o}")


def run_export(args: argparse.Namespace) -> dict[str, Any]:
    destination = args.destination.expanduser().resolve()
    enforce_private_directory(destination)
    chats_dir = destination / "Чаты"
    logs_dir = destination / "Журналы"
    enforce_private_directory(chats_dir)
    enforce_private_directory(logs_dir)

    checkpoint_path = destination / "контрольная точка.json"
    registry_path = destination / "реестр.json"
    report_path = destination / "отчёт.json"
    checkpoint = load_json(checkpoint_path, {"чаты": {}})
    registry = load_json(registry_path, {"чаты": {}})
    known = {
        key: {"last_message_timestamp": value.get("last_message_timestamp")}
        for key, value in checkpoint.get("чаты", {}).items()
    }

    remote_code = REMOTE_EXPORTER
    command = [
        "ssh",
        args.ssh_host,
        "docker",
        "exec",
        "-i",
        args.container,
        "python",
        "-",
        args.session,
        str(args.chat_limit),
        str(args.message_limit),
        base64.urlsafe_b64encode(
            json.dumps(known, separators=(",", ":")).encode("utf-8")
        ).decode("ascii"),
    ]
    process = subprocess.Popen(
        command,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        bufsize=1,
    )
    assert process.stdin is not None
    assert process.stdout is not None
    process.stdin.write(remote_code)
    process.stdin.close()

    writer: ChatWriter | None = None
    header: dict[str, Any] | None = None
    summary: dict[str, Any] | None = None
    errors: list[dict[str, Any]] = []
    totals = {"messages": 0, "text_messages": 0, "media_references": 0}

    try:
        for line in process.stdout:
            event = json.loads(line)
            event_type = event.get("type")
            if event_type == "header":
                header = event
            elif event_type == "chat_start":
                if writer is not None:
                    raise RuntimeError("received chat_start before chat_end")
                writer = ChatWriter(chats_dir, event)
            elif event_type == "message_page":
                if writer is None or writer.chat_hash != event.get("chat_hash"):
                    raise RuntimeError("message page does not match active chat")
                writer.add_messages(event.get("messages") or [])
            elif event_type == "chat_end":
                if writer is None or writer.chat_hash != event.get("chat_hash"):
                    raise RuntimeError("chat_end does not match active chat")
                path, checksum = writer.finish()
                chat_hash = writer.chat_hash
                checkpoint.setdefault("чаты", {})[chat_hash] = {
                    "last_message_timestamp": event.get("last_message_timestamp"),
                    "message_count": writer.message_count,
                    "text_message_count": writer.text_count,
                    "media_reference_count": writer.media_count,
                    "sha256": checksum,
                    "file": str(path.relative_to(destination)),
                }
                registry.setdefault("чаты", {})[chat_hash] = {
                    "данные": load_first_jsonl_record(path).get("данные"),
                    "файл": str(path.relative_to(destination)),
                }
                totals["messages"] += writer.message_count
                totals["text_messages"] += writer.text_count
                totals["media_references"] += writer.media_count
                atomic_json(checkpoint_path, checkpoint)
                atomic_json(registry_path, registry)
                writer = None
            elif event_type == "chat_error":
                errors.append(event)
                if writer is not None and writer.chat_hash == event.get("chat_hash"):
                    writer.abort()
                    writer = None
            elif event_type == "summary":
                summary = event
            else:
                raise RuntimeError(f"unknown export event: {event_type!r}")
    finally:
        if writer is not None:
            writer.abort()

    stderr = process.stderr.read() if process.stderr is not None else ""
    return_code = process.wait()
    if return_code != 0:
        raise RuntimeError(f"remote exporter failed with exit {return_code}: {stderr[-1000:]}")
    if header is None or summary is None:
        raise RuntimeError("remote exporter did not emit header and summary")
    if errors or summary.get("failed"):
        error_log = logs_dir / "ошибки последнего запуска.json"
        atomic_json(error_log, errors)
        raise RuntimeError(f"export completed with {len(errors)} chat errors; see {error_log}")

    archive_totals = summarize_archive(chats_dir)
    report = {
        "источник": "WAHA через приватный контейнер EVO",
        "сеанс": header.get("session"),
        "версия_waha": header.get("version"),
        "движок": header.get("engine"),
        "время_выгрузки": header.get("exported_at"),
        "всего_чатов": header.get("chat_count"),
        "выгружено_чатов": summary.get("exported"),
        "пропущено_неизменённых": summary.get("skipped"),
        "ошибок": summary.get("failed"),
        "сообщений_в_изменённых_чатах": totals["messages"],
        "текстовых_сообщений_в_изменённых_чатах": totals["text_messages"],
        "ссылок_на_медиа_в_изменённых_чатах": totals["media_references"],
        "всего_сообщений_в_архиве": archive_totals["messages"],
        "всего_текстовых_сообщений_в_архиве": archive_totals["text_messages"],
        "всего_ссылок_на_медиа_в_архиве": archive_totals["media_references"],
        "вложения_скачаны": False,
    }
    atomic_json(report_path, report)
    run_stamp = str(header.get("exported_at") or "неизвестно").replace(":", "-")
    atomic_json(logs_dir / f"запуск-{run_stamp}.json", report)
    return report


def load_first_jsonl_record(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        line = handle.readline()
    value = json.loads(line)
    if not isinstance(value, dict):
        raise TypeError("first JSONL record is not an object")
    return value


def summarize_archive(chats_dir: Path) -> dict[str, int]:
    totals = {"messages": 0, "text_messages": 0, "media_references": 0}
    for path in chats_dir.glob("*.jsonl"):
        with path.open("r", encoding="utf-8") as handle:
            for line_number, line in enumerate(handle):
                if line_number == 0:
                    continue
                value = json.loads(line)
                message = value.get("данные") if isinstance(value, dict) else None
                totals["messages"] += 1
                if isinstance(message, dict):
                    totals["text_messages"] += int(bool(message.get("body")))
                    totals["media_references"] += int(message.get("hasMedia") is True)
    return totals


def main() -> int:
    args = parse_args()
    try:
        validate_args(args)
        report = run_export(args)
    except Exception as error:
        print(f"Ошибка выгрузки: {error}", file=sys.stderr)
        return 1
    safe_report = {
        key: value
        for key, value in report.items()
        if key not in {"сеанс"}
    }
    print(json.dumps(safe_report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
