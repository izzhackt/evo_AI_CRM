import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const originalCwd = process.cwd();
const isolatedCwd = await mkdtemp(path.join(os.tmpdir(), "evo-transcription-jobs-"));
process.chdir(isolatedCwd);
const jobs = await import(`../src/lib/transcription/jobs.ts?test=${Date.now()}`);

test.after(() => {
  process.chdir(originalCwd);
});

function record(jobId, jobDir, audioPath, overrides = {}) {
  return {
    jobId,
    provider: "mlx-whisper",
    model: "mlx-community/whisper-large-v3-turbo",
    status: "queued",
    originalName: "../../customer-call.mp3",
    audioPath,
    jobDir,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

test("public job output never exposes names or server paths", async () => {
  const jobId = "20260101000000-aaaaaaaa";
  const jobDir = await jobs.ensureJobDir(jobId);
  const audioPath = path.join(jobDir, jobs.safeAudioStorageName());
  const stored = record(jobId, jobDir, audioPath, {
    status: "failed",
    error: "/private/provider/error with customer content",
    outputs: { json: "/private/output/transcript.json" },
  });
  const visible = jobs.publicJobRecord(stored);
  const serialized = JSON.stringify(visible);
  assert.equal(visible.error, "processing_failed");
  assert.equal(visible.outputs.json, true);
  assert.doesNotMatch(serialized, /customer-call|private|transcript\.json/);
});

test("stale jobs become restart-safe failures and delete retained audio", async () => {
  const jobId = "20260101000001-bbbbbbbb";
  const jobDir = await jobs.ensureJobDir(jobId);
  const audioPath = path.join(jobDir, jobs.safeAudioStorageName());
  await writeFile(audioPath, new Uint8Array([0x49, 0x44, 0x33]));
  await jobs.writeJobRecord(
    record(jobId, jobDir, audioPath, {
      status: "running",
      updatedAt: new Date(Date.now() - jobs.TRANSCRIPTION_STALE_JOB_MS - 1000).toISOString(),
    }),
  );

  const recovered = await jobs.readJobRecord(jobId);
  assert.equal(recovered.status, "failed");
  assert.equal(recovered.error, "processing_interrupted");
  await assert.rejects(stat(audioPath), { code: "ENOENT" });
  const persisted = JSON.parse(await readFile(path.join(jobDir, "status.json"), "utf8"));
  assert.equal(persisted.status, "failed");
});

test("reading a worker-completed job immediately deletes retained source audio", async () => {
  const jobId = "20260101000003-dddddddd";
  const jobDir = await jobs.ensureJobDir(jobId);
  const audioPath = path.join(jobDir, jobs.safeAudioStorageName());
  await writeFile(audioPath, new Uint8Array([0x49, 0x44, 0x33]));
  await jobs.writeJobRecord(
    record(jobId, jobDir, audioPath, {
      status: "completed",
      outputs: { json: path.join(jobDir, "transcript.json") },
    }),
  );

  const completed = await jobs.readJobRecord(jobId);
  assert.equal(completed.status, "completed");
  await assert.rejects(stat(audioPath), { code: "ENOENT" });
});

test("retention cleanup deletes expired job directories", async () => {
  const jobId = "20260101000002-cccccccc";
  const jobDir = await jobs.ensureJobDir(jobId);
  const expired = new Date(Date.now() - jobs.TRANSCRIPTION_JOB_RETENTION_MS - 1000);
  await utimes(jobDir, expired, expired);
  await jobs.cleanupExpiredJobs();
  await assert.rejects(stat(jobDir), { code: "ENOENT" });
});
