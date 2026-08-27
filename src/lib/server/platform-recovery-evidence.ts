import "server-only";

import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import type { PlatformRestoreComponent } from "../platform-observability.ts";
import { parseU11RecoveryResultContract } from "../u11-recovery-result-contract.mjs";

const MAX_EVIDENCE_BYTES = 128 * 1024;

type RecoveryStatus = PlatformRestoreComponent["status"];
type RecoveryEvidenceEnvironment = Record<string, string | undefined>;
type RecoveryEvidenceDependencies = Readonly<{ now?: () => number }>;

export type PlatformRecoveryEvidence = Readonly<{
  source: "missing" | "verified" | "failed";
  resultCode: string | null;
  observedAt: string | null;
  database: PlatformRestoreComponent;
  storage: PlatformRestoreComponent;
}>;

function component(
  status: RecoveryStatus,
  ageSeconds: number | null,
): PlatformRestoreComponent {
  return Object.freeze({ status, age_seconds: ageSeconds });
}

function missingEvidence(): PlatformRecoveryEvidence {
  return Object.freeze({
    source: "missing",
    resultCode: null,
    observedAt: null,
    database: component("missing", null),
    storage: component("missing", null),
  });
}

function failedEvidence(): PlatformRecoveryEvidence {
  return Object.freeze({
    source: "failed",
    resultCode: null,
    observedAt: null,
    database: component("failed", null),
    storage: component("failed", null),
  });
}

function parseEvidence(value: unknown, nowMs: number): PlatformRecoveryEvidence | null {
  const result = parseU11RecoveryResultContract(value);
  if (!result || result.observedMs > nowMs) return null;
  const ageSeconds = Math.min(
    31_536_000,
    Math.max(0, Math.floor((nowMs - result.observedMs) / 1_000)),
  );
  return Object.freeze({
    source: "verified",
    resultCode: result.resultCode,
    observedAt: result.observedAt,
    database: component(result.databaseStatus as RecoveryStatus, ageSeconds),
    storage: component(result.storageStatus as RecoveryStatus, ageSeconds),
  });
}

function isInside(root: string, candidate: string): boolean {
  const relation = relative(root, candidate);
  return relation !== "" && relation !== ".." &&
    !relation.startsWith(`..${sep}`) && !isAbsolute(relation);
}

async function rejectSymlinkedPath(root: string, candidate: string): Promise<boolean> {
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error("unsafe root");
  const relation = relative(root, candidate);
  let current = root;
  const parts = relation.split(sep);
  for (const [index, part] of parts.entries()) {
    current = resolve(current, part);
    let stat;
    try {
      stat = await lstat(current);
    } catch (error) {
      if (
        index === parts.length - 1 &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        return false;
      }
      throw error;
    }
    if (stat.isSymbolicLink()) throw new Error("unsafe symlink");
  }
  return true;
}

export async function loadPlatformRecoveryEvidence(
  environment: RecoveryEvidenceEnvironment = process.env,
  dependencies: RecoveryEvidenceDependencies = {},
): Promise<PlatformRecoveryEvidence> {
  const configuredRoot = environment.EVO_PLATFORM_U11_RECOVERY_EVIDENCE_ROOT;
  const configuredPath = environment.EVO_PLATFORM_U11_RECOVERY_EVIDENCE_PATH;
  if (!configuredRoot && !configuredPath) return missingEvidence();

  try {
    if (!configuredRoot || !configuredPath ||
        !isAbsolute(configuredRoot) || !isAbsolute(configuredPath) ||
        configuredRoot === "/" || configuredRoot.includes("\0") ||
        configuredPath.includes("\0") || !isInside(configuredRoot, configuredPath)) {
      return failedEvidence();
    }
    const evidenceExists = await rejectSymlinkedPath(
      configuredRoot,
      configuredPath,
    );
    if (!evidenceExists) return missingEvidence();
    const canonicalRoot = await realpath(configuredRoot);
    const canonicalPath = await realpath(configuredPath);
    if (!isInside(canonicalRoot, canonicalPath)) return failedEvidence();

    const handle = await open(canonicalPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size < 2 || stat.size > MAX_EVIDENCE_BYTES ||
          (stat.mode & 0o777) !== 0o600) return failedEvidence();
      const raw = await handle.readFile({ encoding: "utf8" });
      const parsed = parseEvidence(
        JSON.parse(raw) as unknown,
        (dependencies.now ?? Date.now)(),
      );
      return parsed ?? failedEvidence();
    } finally {
      await handle.close();
    }
  } catch {
    return failedEvidence();
  }
}
