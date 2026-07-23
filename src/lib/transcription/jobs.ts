import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export type TranscriptionProvider = "mlx-whisper";

export type TranscriptionJobStatus = "queued" | "running" | "completed" | "failed";

export type TranscriptionJobRecord = {
  jobId: string;
  provider: TranscriptionProvider;
  model: string;
  status: TranscriptionJobStatus;
  originalName: string;
  audioPath: string;
  jobDir: string;
  createdAt: string;
  updatedAt: string;
  error?: string;
  outputs?: {
    txt?: string;
    json?: string;
    md?: string;
    events?: string;
  };
};

export type PublicTranscriptionJob = {
  jobId: string;
  provider: TranscriptionProvider;
  model: string;
  status: TranscriptionJobStatus;
  createdAt: string;
  updatedAt: string;
  error?: "processing_failed" | "processing_interrupted";
  outputs?: {
    txt?: boolean;
    json?: boolean;
    md?: boolean;
    events?: boolean;
  };
};

export const TRANSCRIPTION_MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
export const TRANSCRIPTION_MAX_REQUEST_BYTES = TRANSCRIPTION_MAX_UPLOAD_BYTES + 1024 * 1024;
export const TRANSCRIPTION_MAX_CONCURRENT_JOBS = 2;
export const TRANSCRIPTION_JOB_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const TRANSCRIPTION_STALE_JOB_MS = 2 * 60 * 60 * 1000;

const TRANSCRIPTS_DIR = path.join(process.cwd(), "output", "transcripts");
const JOB_ID_PATTERN = /^\d{14}-[a-f0-9]{8}$/;
let creationQueue = Promise.resolve();

export function createJobId() {
  return `${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${randomUUID().slice(0, 8)}`;
}

export function getTranscriptsDir() {
  return TRANSCRIPTS_DIR;
}

export function getJobDir(jobId: string) {
  if (!JOB_ID_PATTERN.test(jobId)) {
    throw new Error("invalid_job_id");
  }
  return path.join(TRANSCRIPTS_DIR, jobId);
}

export function safeAudioStorageName() {
  return `${randomUUID()}.mp3`;
}

export async function ensureJobDir(jobId: string) {
  const jobDir = getJobDir(jobId);
  await mkdir(TRANSCRIPTS_DIR, { recursive: true, mode: 0o700 });
  await mkdir(jobDir, { recursive: false, mode: 0o700 });
  return jobDir;
}

export async function writeJobRecord(record: TranscriptionJobRecord) {
  await mkdir(record.jobDir, { recursive: true, mode: 0o700 });
  const statusPath = path.join(record.jobDir, "status.json");
  const temporaryPath = path.join(record.jobDir, `status.${randomUUID()}.tmp`);
  await writeFile(temporaryPath, JSON.stringify(record, null, 2), { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, statusPath);
}

async function readStoredRecord(jobId: string): Promise<TranscriptionJobRecord | null> {
  try {
    const jobDir = getJobDir(jobId);
    const raw = await readFile(path.join(jobDir, "status.json"), "utf8");
    const record = JSON.parse(raw) as TranscriptionJobRecord;
    if (record.jobId !== jobId || path.resolve(record.jobDir) !== path.resolve(jobDir)) return null;
    if (path.dirname(path.resolve(record.audioPath)) !== path.resolve(jobDir)) return null;
    return record;
  } catch {
    return null;
  }
}

async function removeRetainedAudio(record: TranscriptionJobRecord) {
  if (!isTerminalStatus(record.status)) return;
  await unlink(record.audioPath).catch(() => undefined);
}

export async function readJobRecord(jobId: string): Promise<TranscriptionJobRecord | null> {
  const record = await readStoredRecord(jobId);
  if (!record) return null;
  const updatedAt = Date.parse(record.updatedAt);
  if (
    !isTerminalStatus(record.status) &&
    Number.isFinite(updatedAt) &&
    Date.now() - updatedAt > TRANSCRIPTION_STALE_JOB_MS
  ) {
    const interrupted: TranscriptionJobRecord = {
      ...record,
      status: "failed",
      error: "processing_interrupted",
      updatedAt: new Date().toISOString(),
    };
    await writeJobRecord(interrupted);
    await removeRetainedAudio(interrupted);
    return interrupted;
  }
  await removeRetainedAudio(record);
  return record;
}

export function publicJobRecord(record: TranscriptionJobRecord): PublicTranscriptionJob {
  const error =
    record.status === "failed"
      ? record.error === "processing_interrupted"
        ? "processing_interrupted"
        : "processing_failed"
      : undefined;
  return {
    jobId: record.jobId,
    provider: record.provider,
    model: record.model,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...(error ? { error } : {}),
    ...(record.outputs
      ? {
          outputs: {
            txt: Boolean(record.outputs.txt),
            json: Boolean(record.outputs.json),
            md: Boolean(record.outputs.md),
            events: Boolean(record.outputs.events),
          },
        }
      : {}),
  };
}

export async function cleanupExpiredJobs() {
  await mkdir(TRANSCRIPTS_DIR, { recursive: true, mode: 0o700 });
  const entries = await readdir(TRANSCRIPTS_DIR, { withFileTypes: true });
  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && JOB_ID_PATTERN.test(entry.name))
      .map(async (entry) => {
        const jobDir = getJobDir(entry.name);
        const details = await stat(jobDir).catch(() => null);
        if (details && Date.now() - details.mtimeMs > TRANSCRIPTION_JOB_RETENTION_MS) {
          await rm(jobDir, { recursive: true, force: true });
        }
      }),
  );
}

export async function activeJobCount() {
  await cleanupExpiredJobs();
  const entries = await readdir(TRANSCRIPTS_DIR, { withFileTypes: true });
  let active = 0;
  for (const entry of entries) {
    if (!entry.isDirectory() || !JOB_ID_PATTERN.test(entry.name)) continue;
    const record = await readJobRecord(entry.name);
    if (record && !isTerminalStatus(record.status)) active += 1;
  }
  return active;
}

export async function withJobCreationLock<T>(operation: () => Promise<T>): Promise<T> {
  const previous = creationQueue;
  let release: () => void = () => {};
  creationQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
}

export async function removeJob(jobId: string) {
  await rm(getJobDir(jobId), { recursive: true, force: true });
}

export async function failJob(jobId: string, error: "processing_failed" | "processing_interrupted") {
  const record = await readStoredRecord(jobId);
  if (!record || isTerminalStatus(record.status)) return;
  const failed: TranscriptionJobRecord = {
    ...record,
    status: "failed",
    error,
    updatedAt: new Date().toISOString(),
  };
  await writeJobRecord(failed);
  await removeRetainedAudio(failed);
}

export function isTerminalStatus(status: TranscriptionJobStatus) {
  return status === "completed" || status === "failed";
}
