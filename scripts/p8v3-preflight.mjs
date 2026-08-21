#!/usr/bin/env node

import { chmodSync, lstatSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { P8V3 } from "./p8v3-rollout.mjs";

const SHA40 = /^[0-9a-f]{40}$/;
const SHA64 = /^[0-9a-f]{64}$/;
const IMAGE_ID = /^sha256:[0-9a-f]{64}$/;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
export const P8V3_PREFLIGHT_VERSION = "p8v3k-production-preflight/v1";
export const P8V3_PREFLIGHT_WINDOW_MS = 30 * 60 * 1000;

function fail(message) {
  const error = new Error(message);
  error.code = "preflight_drift";
  throw error;
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")) fail(`${label} is not closed`);
}

export function validateP8V3Preflight(value) {
  exactKeys(value, ["version", "generated_at", "expires_at", "execution", "application", "containers", "waha", "migration", "archives", "crm_runtime_probe", "gemini", "importer", "importer_network", "compose_validated", "prerequisites_verified"], "preflight");
  if (value.version !== P8V3_PREFLIGHT_VERSION || !UTC.test(value.generated_at) || !UTC.test(value.expires_at) || Date.parse(value.expires_at) - Date.parse(value.generated_at) !== P8V3_PREFLIGHT_WINDOW_MS) fail("preflight window drifted");
  exactKeys(value.execution, ["commit", "tree", "ci_run_id"], "preflight execution");
  if (!SHA40.test(value.execution.commit) || !SHA40.test(value.execution.tree) || !Number.isSafeInteger(value.execution.ci_run_id) || value.execution.ci_run_id < 1) fail("preflight execution drifted");
  exactKeys(value.application, ["commit", "tree"], "preflight application");
  if (value.application.commit !== P8V3.applicationCommit || value.application.tree !== P8V3.applicationTree) fail("preflight application drifted");
  if (!Array.isArray(value.containers) || value.containers.length !== 5) fail("preflight container cardinality drifted");
  for (const item of value.containers) {
    exactKeys(item, ["name", "container_id", "image_id", "health", "restart_count", "networks"], "preflight container");
    if (!item.name || !SHA64.test(item.container_id) || !IMAGE_ID.test(item.image_id) || item.health !== "healthy" || item.restart_count !== 0 || !Array.isArray(item.networks) || item.networks.length < 1) fail("preflight container drifted");
  }
  exactKeys(value.waha, ["crm_container_id", "crm_image_id", "inbox_container_id", "inbox_image_id", "unchanged"], "preflight WAHA");
  if (!SHA64.test(value.waha.crm_container_id) || !IMAGE_ID.test(value.waha.crm_image_id) || !SHA64.test(value.waha.inbox_container_id) || !IMAGE_ID.test(value.waha.inbox_image_id) || value.waha.unchanged !== false) fail("preflight WAHA drifted");
  exactKeys(value.migration, ["versions", "range", "count"], "preflight migration");
  if (!Array.isArray(value.migration.versions) || value.migration.versions.length !== 77 || value.migration.range !== "001-077" || value.migration.count !== 77) fail("preflight migration drifted");
  if (!Array.isArray(value.archives) || value.archives.length !== 3) fail("preflight archives drifted");
  for (const item of value.archives) {
    exactKeys(item, ["name", "sha256", "size", "index", "platform"], "preflight archive");
    if (!["crm", "inbox", "lead_agent"].includes(item.name) || !SHA64.test(item.sha256) || !Number.isSafeInteger(item.size) || item.size < 1 || !IMAGE_ID.test(item.index) || !IMAGE_ID.test(item.platform)) fail("preflight archive drifted");
  }
  if (value.archives.map((item) => item.name).sort().join("\0") !== ["crm", "inbox", "lead_agent"].sort().join("\0")) fail("preflight archive names drifted");
  exactKeys(value.crm_runtime_probe, ["status", "backend", "archive_sha256", "index", "platform", "runtime_image_id", "source_prestate", "compose_prestate", "nonce_prestate", "provider_container_id", "provider_container_image_id", "cleanup_verified", "production_unchanged"], "preflight CRM runtime probe");
  exactKeys(value.crm_runtime_probe.backend, ["version", "api", "os", "arch", "driver"], "preflight CRM runtime backend");
  const probe = value.crm_runtime_probe;
  const crmArchive = value.archives.find((item) => item.name === "crm");
  if (probe.status !== "verified" || probe.backend.version !== "29.4.0" || probe.backend.api !== "1.54" || probe.backend.os !== "linux" || probe.backend.arch !== "amd64" || probe.backend.driver !== "io.containerd.snapshotter.v1" || !SHA64.test(probe.archive_sha256) || !IMAGE_ID.test(probe.index) || !IMAGE_ID.test(probe.platform) || probe.archive_sha256 !== crmArchive?.sha256 || probe.index !== crmArchive?.index || probe.platform !== crmArchive?.platform || probe.runtime_image_id !== probe.index || !["absent", "exact_present"].includes(probe.source_prestate) || probe.compose_prestate !== "absent" || probe.nonce_prestate !== "absent" || !SHA64.test(probe.provider_container_id) || probe.provider_container_image_id !== probe.index || probe.cleanup_verified !== true || probe.production_unchanged !== true) fail("preflight CRM runtime probe drifted");
  exactKeys(value.gemini, ["embedding_verified", "draft_verified", "retrieval_provider_verified", "server_compose_verified"], "preflight Gemini");
  if (value.gemini.embedding_verified !== true || value.gemini.draft_verified !== true || value.gemini.retrieval_provider_verified !== true || value.gemini.server_compose_verified !== true) fail("preflight Gemini drifted");
  exactKeys(value.importer, ["sha256", "size", "verified"], "preflight importer");
  if (!SHA64.test(value.importer.sha256) || !Number.isSafeInteger(value.importer.size) || value.importer.size < 1 || value.importer.size > 4 * 1024 * 1024 || value.importer.verified !== true) fail("preflight importer drifted");
  exactKeys(value.importer_network, ["name", "driver", "scope", "internal", "dns"], "preflight importer network");
  if (value.importer_network.name !== "evo_crm_private" || value.importer_network.driver !== "bridge" || value.importer_network.scope !== "local" || value.importer_network.internal !== false || value.importer_network.dns !== "127.0.0.11") fail("preflight importer network drifted");
  if (value.compose_validated !== true || value.prerequisites_verified !== true) fail("preflight readiness drifted");
  return value;
}

export async function runP8V3Preflight({ operations, now = () => Date.now() }) {
  const started = now();
  const execution = await operations.executionIdentity();
  const observed = await operations.preflight({ deadlineAt: started + P8V3_PREFLIGHT_WINDOW_MS });
  const result = {
    version: P8V3_PREFLIGHT_VERSION,
    generated_at: new Date(started).toISOString(),
    expires_at: new Date(started + P8V3_PREFLIGHT_WINDOW_MS).toISOString(),
    execution,
    application: { commit: P8V3.applicationCommit, tree: P8V3.applicationTree },
    ...observed,
  };
  return validateP8V3Preflight(result);
}

export function writeP8V3Preflight(path, value) {
  validateP8V3Preflight(value);
  const target = resolve(path);
  const temporary = `${target}.tmp-${process.pid}`;
  const bytes = `${JSON.stringify(value, null, 2)}\n`;
  if (UUID.test(bytes) || /(?:sbp_|eyJ[A-Za-z0-9_-]*\.|GEMINI_API_KEY=|CLIENT_SECRET=|REFRESH_TOKEN=)/.test(bytes)) fail("preflight privacy validation failed");
  writeFileSync(temporary, bytes, { flag: "wx", mode: 0o600 });
  chmodSync(temporary, 0o600);
  renameSync(temporary, target);
  const metadata = lstatSync(target);
  if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o777) !== 0o600) fail("preflight artifact is unsafe");
  return target;
}
