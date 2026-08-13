#!/usr/bin/env python3
"""Download WAHA historical media without exposing the WAHA credential."""

from __future__ import annotations

import argparse
import hashlib
import json
import mimetypes
import os
from pathlib import Path
import re
import subprocess
import sys
import tarfile
import tempfile
from typing import Any


REMOTE_DOWNLOADER = r'''
import base64
import io
import json
import os
import sys
import tarfile
import urllib.parse
import urllib.request

session = sys.argv[1]
jobs = __EVO_JOBS__
base_url = os.environ["EVO_AGENT_WAHA_BASE_URL"].rstrip("/")
api_key = os.environ["EVO_AGENT_WAHA_API_KEY"]
headers = {"X-Api-Key": api_key, "Accept": "application/json"}
results = []


def request_json(path):
    request = urllib.request.Request(base_url + path, headers=headers)
    with urllib.request.urlopen(request, timeout=180) as response:
        return json.load(response)


def local_media_url(value):
    parsed = urllib.parse.urlparse(value)
    if not parsed.scheme:
        return base_url + "/" + value.lstrip("/")
    base = urllib.parse.urlparse(base_url)
    return urllib.parse.urlunparse((base.scheme, base.netloc, parsed.path, parsed.params, parsed.query, parsed.fragment))


with tarfile.open(fileobj=sys.stdout.buffer, mode="w|") as archive:
    for job in jobs:
        result = {"key": job["key"], "status": "error"}
        try:
            path = (
                "/api/" + urllib.parse.quote(session, safe="") + "/chats/"
                + urllib.parse.quote(job["chat_id"], safe="") + "/messages/"
                + urllib.parse.quote(job["message_id"], safe="") + "?downloadMedia=true"
            )
            message = request_json(path)
            media = message.get("media") or {}
            if media.get("error"):
                raise RuntimeError(str(media["error"]))
            url = media.get("url") or message.get("mediaUrl")
            if not url:
                raise RuntimeError("WAHA returned no media URL")
            media_request = urllib.request.Request(local_media_url(url), headers={"X-Api-Key": api_key})
            with urllib.request.urlopen(media_request, timeout=300) as response:
                payload = response.read()
                content_type = response.headers.get_content_type()
            filename = job["key"] + job["extension"]
            info = tarfile.TarInfo("Файлы/" + filename)
            info.size = len(payload)
            info.mode = 0o600
            archive.addfile(info, io.BytesIO(payload))
            result.update({
                "status": "downloaded",
                "file": "Файлы/" + filename,
                "bytes": len(payload),
                "sha256": __import__("hashlib").sha256(payload).hexdigest(),
                "mimetype": media.get("mimetype") or content_type,
                "original_filename": media.get("filename"),
            })
        except Exception as error:
            result.update({"error_type": type(error).__name__, "error": str(error)[:500]})
        results.append(result)

    encoded = json.dumps(results, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    info = tarfile.TarInfo("результаты.json")
    info.size = len(encoded)
    info.mode = 0o600
    archive.addfile(info, io.BytesIO(encoded))
'''


SAFE_NAME = re.compile(r"^[A-Za-z0-9._-]+$")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Загрузка медиа из защищённого архива WAHA")
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--destination", type=Path, required=True)
    parser.add_argument("--ssh-host", default="hermes-vps")
    parser.add_argument("--container", default="evo-crm-lead-agent-1")
    parser.add_argument("--session", default="crm_primary")
    parser.add_argument("--batch-size", type=int, default=10)
    parser.add_argument(
        "--request-timeout",
        type=int,
        default=90,
        help="Максимальное время одного удалённого пакета в секундах",
    )
    return parser.parse_args()


def serialized_id(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, dict) and isinstance(value.get("_serialized"), str):
        return value["_serialized"]
    raise ValueError("message or chat id has no serialized string")


def extension_for(message: dict[str, Any]) -> str:
    data = message.get("_data") or {}
    mimetype = str(data.get("mimetype") or "application/octet-stream").split(";", 1)[0]
    explicit = {
        "audio/ogg": ".ogg",
        "application/pdf": ".pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
        "image/heic": ".heic",
        "image/webp": ".webp",
        "video/quicktime": ".mov",
    }
    return explicit.get(mimetype) or mimetypes.guess_extension(mimetype) or ".bin"


def media_jobs(archive: Path) -> list[dict[str, Any]]:
    jobs: list[dict[str, Any]] = []
    for chat_path in sorted((archive / "Чаты").glob("*.jsonl")):
        chat_id: str | None = None
        with chat_path.open("r", encoding="utf-8") as handle:
            for line_number, line in enumerate(handle):
                record = json.loads(line)
                data = record.get("данные") if isinstance(record, dict) else None
                if line_number == 0:
                    if not isinstance(data, dict):
                        raise TypeError(f"invalid chat metadata: {chat_path}")
                    chat_id = serialized_id(data.get("id"))
                    continue
                if not isinstance(data, dict) or data.get("hasMedia") is not True:
                    continue
                if chat_id is None:
                    raise ValueError(f"chat id missing: {chat_path}")
                message_id = serialized_id(data.get("id"))
                key = hashlib.sha256((chat_id + "\0" + message_id).encode("utf-8")).hexdigest()
                raw = data.get("_data") or {}
                jobs.append({
                    "key": key,
                    "chat_id": chat_id,
                    "message_id": message_id,
                    "source_chat_file": chat_path.name,
                    "source_message_hash": hashlib.sha256(message_id.encode("utf-8")).hexdigest(),
                    "extension": extension_for(data),
                    "expected_bytes": raw.get("size"),
                    "expected_mimetype": raw.get("mimetype"),
                    "timestamp": data.get("timestamp"),
                })
    return sorted(jobs, key=lambda item: item.get("timestamp") or 0, reverse=True)


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
    return json.loads(path.read_text(encoding="utf-8"))


def valid_existing(destination: Path, entry: dict[str, Any]) -> bool:
    relative = entry.get("file")
    checksum = entry.get("sha256")
    if not isinstance(relative, str) or not isinstance(checksum, str):
        return False
    path = destination / relative
    if not path.is_file():
        return False
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    return digest == checksum


def safe_extract_batch(tar_path: Path, destination: Path) -> list[dict[str, Any]]:
    with tarfile.open(tar_path, "r:") as archive:
        members = archive.getmembers()
        allowed = re.compile(r"^(Файлы/[a-f0-9]{64}\.[A-Za-z0-9]+|результаты\.json)$")
        for member in members:
            if not member.isfile() or not allowed.fullmatch(member.name):
                raise ValueError(f"unsafe tar member: {member.name!r}")
        result_member = archive.getmember("результаты.json")
        result_file = archive.extractfile(result_member)
        if result_file is None:
            raise ValueError("batch results are missing")
        results = json.load(result_file)
        for member in members:
            if member.name == "результаты.json":
                continue
            source = archive.extractfile(member)
            if source is None:
                raise ValueError(f"could not read {member.name}")
            target = destination / member.name
            target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            os.chmod(target.parent, 0o700)
            temporary = target.with_suffix(target.suffix + ".part")
            with temporary.open("wb") as handle:
                os.chmod(temporary, 0o600)
                for chunk in iter(lambda: source.read(1024 * 1024), b""):
                    handle.write(chunk)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, target)
        return results


def main() -> int:
    args = parse_args()
    for value in (args.ssh_host, args.container, args.session):
        if not SAFE_NAME.fullmatch(value):
            raise ValueError(f"unsafe remote identifier: {value!r}")
    if args.batch_size < 1 or args.batch_size > 50:
        raise ValueError("batch size must be between 1 and 50")
    if args.request_timeout < 5 or args.request_timeout > 600:
        raise ValueError("request timeout must be between 5 and 600 seconds")

    archive = args.archive.expanduser().resolve()
    destination = args.destination.expanduser().resolve()
    destination.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(destination, 0o700)
    manifest_path = destination / "реестр медиа.json"
    manifest = load_json(manifest_path, {"элементы": {}})
    jobs = media_jobs(archive)
    pending = [
        job for job in jobs
        if not valid_existing(destination, manifest.get("элементы", {}).get(job["key"], {}))
    ]

    for offset in range(0, len(pending), args.batch_size):
        batch = pending[offset : offset + args.batch_size]
        fd, temporary_name = tempfile.mkstemp(prefix="evo-waha-media-", suffix=".tar")
        os.close(fd)
        temporary = Path(temporary_name)
        try:
            batch_script = REMOTE_DOWNLOADER.replace(
                "__EVO_JOBS__",
                repr(batch),
                1,
            )
            try:
                with temporary.open("wb") as output:
                    process = subprocess.run(
                        [
                            "ssh", args.ssh_host, "docker", "exec", "-i", args.container,
                            "python", "-", args.session,
                        ],
                        input=batch_script.encode("utf-8"),
                        stdout=output,
                        stderr=subprocess.PIPE,
                        check=False,
                        timeout=args.request_timeout,
                    )
            except subprocess.TimeoutExpired:
                for job in batch:
                    entry = {
                        **job,
                        "status": "error",
                        "error_type": "TimeoutExpired",
                        "error": f"WAHA media retrieval exceeded {args.request_timeout} seconds",
                    }
                    entry.pop("chat_id", None)
                    entry.pop("message_id", None)
                    manifest.setdefault("элементы", {})[job["key"]] = entry
                atomic_json(manifest_path, manifest)
                print(
                    json.dumps(
                        {"обработано": min(offset + len(batch), len(pending)), "осталось": len(pending) - offset - len(batch), "тайм-аут": len(batch)},
                        ensure_ascii=False,
                    ),
                    flush=True,
                )
                continue
            if process.returncode != 0:
                raise RuntimeError(
                    f"remote media batch failed with exit {process.returncode}: "
                    + process.stderr.decode("utf-8", errors="replace")[-1000:]
                )
            results = safe_extract_batch(temporary, destination)
            by_key = {job["key"]: job for job in batch}
            for result in results:
                job = by_key[result["key"]]
                entry = {**job, **result}
                expected = entry.get("expected_bytes")
                entry["size_matches_expected"] = (
                    expected is None or entry.get("status") != "downloaded" or expected == entry.get("bytes")
                )
                entry.pop("chat_id", None)
                entry.pop("message_id", None)
                manifest.setdefault("элементы", {})[result["key"]] = entry
            atomic_json(manifest_path, manifest)
            print(
                json.dumps(
                    {"обработано": min(offset + len(batch), len(pending)), "осталось": len(pending) - offset - len(batch)},
                    ensure_ascii=False,
                ),
                flush=True,
            )
        finally:
            temporary.unlink(missing_ok=True)

    entries = manifest.get("элементы", {})
    report = {
        "всего_ссылок_на_медиа": len(jobs),
        "скачано": sum(entry.get("status") == "downloaded" for entry in entries.values()),
        "ошибок": sum(entry.get("status") != "downloaded" for entry in entries.values()),
        "байт": sum(entry.get("bytes", 0) for entry in entries.values()),
    }
    atomic_json(destination / "отчёт медиа.json", report)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["ошибок"] == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())
