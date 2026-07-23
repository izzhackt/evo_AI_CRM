import { spawn } from "node:child_process";
import { closeSync, createWriteStream, openSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { readMultipartFormData } from "@/lib/request";
import {
  activeJobCount,
  createJobId,
  ensureJobDir,
  failJob,
  removeJob,
  readJobRecord,
  safeAudioStorageName,
  TRANSCRIPTION_MAX_CONCURRENT_JOBS,
  TRANSCRIPTION_MAX_REQUEST_BYTES,
  TRANSCRIPTION_MAX_UPLOAD_BYTES,
  withJobCreationLock,
  writeJobRecord,
  type TranscriptionJobRecord,
  type TranscriptionProvider,
} from "@/lib/transcription/jobs";
import { DEFAULT_TRANSCRIPTION_MODEL, isSupportedTranscriptionModel } from "@/lib/transcription/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const WORKER_TIMEOUT_MS = 2 * 60 * 60 * 1000;

function isLocalTranscriptionEnabled() {
  return process.env.EVO_ENABLE_LOCAL_TRANSCRIPTION === "1";
}

async function isMp3(file: File) {
  if (!file.name.toLowerCase().endsWith(".mp3")) return false;
  if (!["audio/mpeg", "audio/mp3"].includes(file.type)) return false;
  const header = new Uint8Array(await file.slice(0, 3).arrayBuffer());
  const hasId3 = header[0] === 0x49 && header[1] === 0x44 && header[2] === 0x33;
  const hasFrameSync = header[0] === 0xff && (header[1] & 0xe0) === 0xe0;
  return hasId3 || hasFrameSync;
}

function startWorker(record: TranscriptionJobRecord) {
  const recordFailure = (error: "processing_failed" | "processing_interrupted") => {
    void failJob(record.jobId, error).catch(() => {
      console.error("Could not persist transcription worker failure");
    });
  };
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
  let descriptorsClosed = false;
  const closeDescriptors = () => {
    if (descriptorsClosed) return;
    descriptorsClosed = true;
    closeSync(outFd);
    closeSync(errFd);
  };
  child.once("spawn", () => {
    closeDescriptors();
  });
  child.once("error", () => {
    closeDescriptors();
    recordFailure("processing_failed");
  });
  const timeout = setTimeout(() => {
    child.kill("SIGTERM");
    recordFailure("processing_interrupted");
  }, WORKER_TIMEOUT_MS);
  timeout.unref();
  child.once("exit", (code) => {
    clearTimeout(timeout);
    if (code !== 0) {
      recordFailure("processing_failed");
      return;
    }
    void readJobRecord(record.jobId).catch(() => {
      console.error("Could not finalize transcription audio retention");
    });
  });
  child.unref();
}

export async function POST(req: NextRequest) {
  const authorization = await requireAdminApi();
  if (authorization.response) return authorization.response;

  const contentLength = Number(req.headers.get("content-length"));
  if (
    Number.isFinite(contentLength) &&
    (contentLength <= 0 || contentLength > TRANSCRIPTION_MAX_REQUEST_BYTES)
  ) {
    return NextResponse.json({ error: "request_too_large" }, { status: 413 });
  }

  const parsed = await readMultipartFormData(req, TRANSCRIPTION_MAX_REQUEST_BYTES);
  if ("error" in parsed) {
    return NextResponse.json(
      { error: parsed.error },
      { status: parsed.error === "request_too_large" ? 413 : 400 },
    );
  }
  const { formData } = parsed;
  if ([...formData.entries()].length > 3) {
    return NextResponse.json({ error: "too_many_form_fields" }, { status: 400 });
  }
  const files = formData.getAll("file");
  if (files.length !== 1) {
    return NextResponse.json({ error: "exactly_one_file_required" }, { status: 400 });
  }
  const file = formData.get("file");
  const provider = (formData.get("provider") || "mlx-whisper") as TranscriptionProvider;
  const model = String(formData.get("model") || DEFAULT_TRANSCRIPTION_MODEL);

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "missing_file" }, { status: 400 });
  }
  if (provider !== "mlx-whisper") {
    return NextResponse.json({ error: "provider_not_available" }, { status: 400 });
  }
  if (!isSupportedTranscriptionModel(model)) {
    return NextResponse.json({ error: "unsupported_model" }, { status: 400 });
  }
  if (file.size <= 0) {
    return NextResponse.json({ error: "empty_file" }, { status: 400 });
  }
  if (file.size > TRANSCRIPTION_MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "file_too_large" }, { status: 413 });
  }
  if (!(await isMp3(file))) {
    return NextResponse.json({ error: "unsupported_file_type" }, { status: 415 });
  }
  if (!isLocalTranscriptionEnabled()) {
    return NextResponse.json({ error: "provider_not_configured" }, { status: 503 });
  }

  return withJobCreationLock(async () => {
    if ((await activeJobCount()) >= TRANSCRIPTION_MAX_CONCURRENT_JOBS) {
      return NextResponse.json({ error: "processing_capacity_reached" }, { status: 429 });
    }

    const jobId = createJobId();
    const jobDir = await ensureJobDir(jobId);
    const audioPath = path.join(jobDir, safeAudioStorageName());
    try {
      const buffer = Buffer.from(await file.arrayBuffer());
      if (buffer.byteLength !== file.size || buffer.byteLength > TRANSCRIPTION_MAX_UPLOAD_BYTES) {
        throw new Error("invalid_upload_size");
      }
      await writeFile(audioPath, buffer, { mode: 0o600, flag: "wx" });
      const now = new Date().toISOString();
      const record: TranscriptionJobRecord = {
        jobId,
        provider,
        model,
        status: "queued",
        originalName: path.basename(file.name).slice(0, 255),
        audioPath,
        jobDir,
        createdAt: now,
        updatedAt: now,
      };
      await writeJobRecord(record);
      createWriteStream(path.join(jobDir, "events.jsonl"), { flags: "a", mode: 0o600 }).end();
      startWorker(record);
    } catch (error) {
      await removeJob(jobId);
      console.error("Transcription worker initialization failed:", error);
      return NextResponse.json({ error: "worker_start_failed" }, { status: 500 });
    }

    return NextResponse.json({
      jobId,
      status: "queued",
      provider,
      model,
      eventsUrl: `/api/transcription/jobs/${jobId}/events`,
      statusUrl: `/api/transcription/jobs/${jobId}`,
    });
  });
}
