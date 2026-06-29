import { spawn } from "node:child_process";
import { createWriteStream, openSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import {
  createJobId,
  ensureJobDir,
  sanitizeFileName,
  writeJobRecord,
  type TranscriptionJobRecord,
  type TranscriptionProvider,
} from "@/lib/transcription/jobs";
import { DEFAULT_TRANSCRIPTION_MODEL, isSupportedTranscriptionModel } from "@/lib/transcription/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_UPLOAD_BYTES = 300 * 1024 * 1024;

function isLocalTranscriptionEnabled() {
  return process.env.EVO_ENABLE_LOCAL_TRANSCRIPTION === "1" || process.env.NODE_ENV !== "production";
}

function isMp3(file: File) {
  return file.name.toLowerCase().endsWith(".mp3") || file.type === "audio/mpeg" || file.type === "audio/mp3";
}

function startWorker(record: TranscriptionJobRecord) {
  const logPath = path.join(record.jobDir, "worker.log");
  const outFd = openSync(logPath, "a");
  const errFd = openSync(logPath, "a");
  const child = spawn(
    "uv",
    [
      "run",
      "--with",
      "mlx-whisper",
      "--with",
      "huggingface_hub[hf_xet]",
      "python",
      "scripts/transcribe_mlx_chunks.py",
      "--job-dir",
      record.jobDir,
      "--audio",
      record.audioPath,
      "--model",
      record.model,
      "--chunk-seconds",
      "60",
      "--overlap",
      "3",
    ],
    {
      cwd: process.cwd(),
      detached: true,
      stdio: ["ignore", outFd, errFd],
      env: {
        ...process.env,
        PYTHONUNBUFFERED: "1",
      },
    },
  );
  child.unref();
}

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("file");
  const provider = (formData.get("provider") || "mlx-whisper") as TranscriptionProvider;
  const model = String(formData.get("model") || DEFAULT_TRANSCRIPTION_MODEL);

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "missing_file" }, { status: 400 });
  }
  if (provider !== "mlx-whisper") {
    return NextResponse.json({ error: "provider_not_available" }, { status: 400 });
  }
  if (!isLocalTranscriptionEnabled()) {
    return NextResponse.json(
      {
        error: "provider_not_configured",
        message: "Local MLX transcription is not enabled on this production server.",
      },
      { status: 503 },
    );
  }
  if (!isSupportedTranscriptionModel(model)) {
    return NextResponse.json({ error: "unsupported_model" }, { status: 400 });
  }
  if (!isMp3(file)) {
    return NextResponse.json({ error: "unsupported_file_type" }, { status: 415 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "file_too_large" }, { status: 413 });
  }

  const jobId = createJobId();
  const jobDir = await ensureJobDir(jobId);
  const safeName = sanitizeFileName(file.name.endsWith(".mp3") ? file.name : `${file.name}.mp3`);
  const audioPath = path.join(jobDir, safeName);
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(audioPath, buffer);
  const now = new Date().toISOString();
  const record: TranscriptionJobRecord = {
    jobId,
    provider,
    model,
    status: "queued",
    originalName: file.name,
    audioPath,
    jobDir,
    createdAt: now,
    updatedAt: now,
  };
  await writeJobRecord(record);
  createWriteStream(path.join(jobDir, "events.jsonl"), { flags: "a" }).end();

  try {
    startWorker(record);
  } catch (error) {
    const message = error instanceof Error ? error.message : "could not start worker";
    return NextResponse.json({ error: "worker_start_failed", message }, { status: 500 });
  }

  return NextResponse.json({
    jobId,
    status: "queued",
    provider,
    model,
    eventsUrl: `/api/transcription/jobs/${jobId}/events`,
    statusUrl: `/api/transcription/jobs/${jobId}`,
  });
}
