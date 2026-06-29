#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


class JobWriter:
    def __init__(self, job_dir: Path, provider: str, model: str, audio: Path) -> None:
        self.job_dir = job_dir
        self.provider = provider
        self.model = model
        self.audio = audio
        self.events_path = job_dir / "events.jsonl"
        self.status_path = job_dir / "status.json"

    def emit(self, event: str, payload: dict[str, Any] | None = None) -> None:
        body = {
            "event": event,
            "timestamp": now_iso(),
            "provider": self.provider,
            "model": self.model,
            **(payload or {}),
        }
        with self.events_path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(body, ensure_ascii=False) + "\n")

    def update_status(self, status: str, **extra: Any) -> None:
        current: dict[str, Any] = {}
        if self.status_path.exists():
            try:
                current = json.loads(self.status_path.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                current = {}
        current.update({"status": status, "updatedAt": now_iso(), **extra})
        write_json(self.status_path, current)


def ffprobe_duration(audio: Path) -> float:
    proc = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(audio),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    return float(proc.stdout.strip())


def make_chunk(audio: Path, out: Path, start: float, duration: float) -> None:
    subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-ss",
            f"{start:.3f}",
            "-t",
            f"{duration:.3f}",
            "-i",
            str(audio),
            "-vn",
            "-ac",
            "1",
            "-ar",
            "16000",
            str(out),
        ],
        check=True,
    )


def timestamp(seconds: float) -> str:
    seconds = max(0.0, seconds)
    minutes = int(seconds // 60)
    rest = seconds - minutes * 60
    return f"{minutes:02d}:{rest:05.2f}"


def normalize_segment(raw: dict[str, Any], offset: float) -> dict[str, Any]:
    start = float(raw.get("start") or 0.0) + offset
    end = float(raw.get("end") or start) + offset
    return {
        "start": round(start, 3),
        "end": round(end, 3),
        "text": str(raw.get("text") or "").strip(),
    }


def write_outputs(
    job_dir: Path,
    audio: Path,
    provider: str,
    model: str,
    language: str | None,
    duration: float,
    elapsed: float,
    segments: list[dict[str, Any]],
) -> dict[str, str]:
    txt_path = job_dir / "transcript.txt"
    json_path = job_dir / "transcript.json"
    md_path = job_dir / "transcript.md"
    text = "\n".join(seg["text"] for seg in segments if seg.get("text")).strip()
    txt_path.write_text(text + ("\n" if text else ""), encoding="utf-8")
    payload = {
        "audio": str(audio),
        "provider": provider,
        "model": model,
        "language": language,
        "durationSeconds": round(duration, 3),
        "elapsedSeconds": round(elapsed, 3),
        "segments": segments,
        "text": text,
    }
    write_json(json_path, payload)
    lines = [
        "# Transcript",
        "",
        f"- Audio: `{audio.name}`",
        f"- Provider: `{provider}`",
        f"- Model: `{model}`",
        f"- Detected language: `{language or 'unknown'}`",
        f"- Duration: `{timestamp(duration)}`",
        "",
        "## Conversation",
        "",
    ]
    for seg in segments:
        if seg.get("text"):
            lines.append(f"**[{timestamp(seg['start'])} - {timestamp(seg['end'])}]** {seg['text']}")
    md_path.write_text("\n".join(lines).strip() + "\n", encoding="utf-8")
    return {"txt": str(txt_path), "json": str(json_path), "md": str(md_path)}


def transcribe(args: argparse.Namespace) -> int:
    import mlx_whisper

    audio = Path(args.audio).expanduser().resolve()
    job_dir = Path(args.job_dir).expanduser().resolve()
    chunks_dir = job_dir / "chunks"
    chunks_dir.mkdir(parents=True, exist_ok=True)
    writer = JobWriter(job_dir, "mlx-whisper", args.model, audio)
    started = time.time()
    writer.update_status("running")
    duration = ffprobe_duration(audio)
    chunk_seconds = max(15.0, float(args.chunk_seconds))
    overlap = max(0.0, min(float(args.overlap), chunk_seconds / 4))
    step = chunk_seconds - overlap
    total_chunks = max(1, math.ceil(max(duration - overlap, 0.01) / step))
    writer.emit(
        "job_started",
        {
            "audioName": audio.name,
            "durationSeconds": round(duration, 3),
            "totalChunks": total_chunks,
        },
    )

    all_segments: list[dict[str, Any]] = []
    detected_language: str | None = None
    last_end = -1.0
    for index in range(total_chunks):
        start = max(0.0, index * step)
        if start >= duration:
            break
        length = min(chunk_seconds, duration - start)
        chunk_path = chunks_dir / f"chunk_{index + 1:04d}.wav"
        writer.emit(
            "chunk_started",
            {
                "chunkIndex": index + 1,
                "totalChunks": total_chunks,
                "start": round(start, 3),
                "end": round(start + length, 3),
            },
        )
        make_chunk(audio, chunk_path, start, length)
        result = mlx_whisper.transcribe(
            str(chunk_path),
            path_or_hf_repo=args.model,
            word_timestamps=True,
            verbose=False,
        )
        detected_language = detected_language or result.get("language")
        accepted: list[dict[str, Any]] = []
        for raw in result.get("segments", []):
            seg = normalize_segment(raw, start)
            if not seg["text"] or seg["end"] <= last_end + 0.2:
                continue
            accepted.append(seg)
            all_segments.append(seg)
            last_end = max(last_end, seg["end"])
        writer.emit(
            "chunk_transcribed",
            {
                "chunkIndex": index + 1,
                "totalChunks": total_chunks,
                "language": result.get("language") or detected_language,
                "progress": round((index + 1) / total_chunks, 4),
                "segments": accepted,
                "text": " ".join(seg["text"] for seg in accepted).strip(),
            },
        )

    outputs = write_outputs(
        job_dir,
        audio,
        "mlx-whisper",
        args.model,
        detected_language,
        duration,
        time.time() - started,
        all_segments,
    )
    outputs["events"] = str(writer.events_path)
    writer.emit(
        "job_completed",
        {
            "language": detected_language,
            "elapsedSeconds": round(time.time() - started, 3),
            "outputs": outputs,
        },
    )
    writer.update_status("completed", outputs=outputs)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--job-dir", required=True)
    parser.add_argument("--audio", required=True)
    parser.add_argument("--model", default="mlx-community/whisper-large-v3-turbo")
    parser.add_argument("--chunk-seconds", type=float, default=60.0)
    parser.add_argument("--overlap", type=float, default=3.0)
    args = parser.parse_args()
    writer = JobWriter(Path(args.job_dir), "mlx-whisper", args.model, Path(args.audio))
    try:
        return transcribe(args)
    except Exception as exc:
        writer.emit("job_failed", {"error": str(exc)})
        writer.update_status("failed", error=str(exc))
        print(f"transcription failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
