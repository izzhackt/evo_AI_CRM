import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type TranscriptionProvider = "mlx-whisper";

export type TranscriptionJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed";

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

const TRANSCRIPTS_DIR = path.join(process.cwd(), "output", "transcripts");

export function createJobId() {
  return `${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${randomUUID().slice(0, 8)}`;
}

export function getTranscriptsDir() {
  return TRANSCRIPTS_DIR;
}

export function getJobDir(jobId: string) {
  if (!/^\d{14}-[a-f0-9]{8}$/.test(jobId)) {
    throw new Error("invalid_job_id");
  }
  return path.join(TRANSCRIPTS_DIR, jobId);
}

export function sanitizeFileName(name: string) {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[^\wа-яА-ЯёЁ.-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned || "call.mp3";
}

export async function ensureJobDir(jobId: string) {
  const jobDir = getJobDir(jobId);
  await mkdir(jobDir, { recursive: true });
  return jobDir;
}

export async function writeJobRecord(record: TranscriptionJobRecord) {
  await mkdir(record.jobDir, { recursive: true });
  await writeFile(path.join(record.jobDir, "status.json"), JSON.stringify(record, null, 2), "utf8");
}

export async function readJobRecord(jobId: string): Promise<TranscriptionJobRecord | null> {
  try {
    const jobDir = getJobDir(jobId);
    const raw = await readFile(path.join(jobDir, "status.json"), "utf8");
    return JSON.parse(raw) as TranscriptionJobRecord;
  } catch {
    return null;
  }
}

export function isTerminalStatus(status: TranscriptionJobStatus) {
  return status === "completed" || status === "failed";
}
