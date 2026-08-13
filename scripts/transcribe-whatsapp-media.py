#!/usr/bin/env python3
"""Transcribe WhatsApp audio/video locally with MLX Whisper."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import tempfile

import mlx_whisper


def parse_args():
    parser = argparse.ArgumentParser(description="Локальная расшифровка аудио и видео WhatsApp")
    parser.add_argument("--media", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--model", default="mlx-community/whisper-large-v3-turbo")
    return parser.parse_args()


def atomic_text(path: Path, text: str):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(path.parent, 0o700)
    fd, temporary = tempfile.mkstemp(prefix=path.name + ".", suffix=".part", dir=path.parent)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    except BaseException:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
        raise


def main():
    args = parse_args()
    media = args.media.expanduser().resolve()
    output = args.output.expanduser().resolve()
    output.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(output, 0o700)
    completed = skipped = failed = 0
    for source in sorted((media / "Файлы").glob("*")):
        if source.suffix.casefold() not in {".ogg", ".mp4", ".mov"}:
            continue
        digest = hashlib.sha256(source.read_bytes()).hexdigest()
        destination = output / f"{source.name}.расшифровка.md"
        if destination.exists() and f"sha256_источника: {digest}" in destination.read_text(encoding="utf-8", errors="replace")[:1000]:
            skipped += 1
            continue
        try:
            result = mlx_whisper.transcribe(
                str(source),
                path_or_hf_repo=args.model,
                condition_on_previous_text=False,
            )
            text = str(result.get("text") or "").strip()
            language = str(result.get("language") or "не определён")
            content = "\n".join([
                "---",
                "тип: автоматическая_расшифровка",
                "статус: черновик_требует_проверки",
                "доступ_для_клиентского_ии: false",
                f"sha256_источника: {digest}",
                f"модель: {args.model}",
                f"язык: {language}",
                "---",
                "",
                f"# Расшифровка — {source.stem}",
                "",
                f"- Источник: `../Медиа/Файлы/{source.name}`",
                "- Метод: локальный MLX Whisper; данные не отправлялись во внешний API.",
                "- Качество: автоматический черновик, ошибки распознавания возможны.",
                "",
                "## Текст",
                "",
                text or "Речь не распознана.",
                "",
            ])
            atomic_text(destination, content)
            completed += 1
        except Exception as error:
            atomic_text(destination, "\n".join([
                "---",
                "тип: автоматическая_расшифровка",
                "статус: ошибка",
                "доступ_для_клиентского_ии: false",
                f"sha256_источника: {digest}",
                "---",
                "",
                f"# Ошибка расшифровки — {source.stem}",
                "",
                f"- Ошибка: `{type(error).__name__}: {str(error)[:500]}`",
                "",
            ]))
            failed += 1
        print(json.dumps({"готово": completed, "пропущено": skipped, "ошибок": failed}, ensure_ascii=False), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
