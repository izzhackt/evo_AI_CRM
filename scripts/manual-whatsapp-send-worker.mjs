import { createHmac, randomUUID } from "node:crypto";
import { chmod, mkdir, open, rename, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ENDPOINT =
  "http://evo-crm-app:3000/api/internal/platform-messaging/manual-send/work";
const HEARTBEAT_PATH = "/tmp/evo-manual-send-worker/heartbeat";
const INTERVAL_MS = 5_000;
const REQUEST_TIMEOUT_MS = 10_000;
const HEARTBEAT_MAX_AGE_MS = 30_000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function fail(message) {
  throw new Error(message);
}

function requiredSecret(value) {
  if (
    typeof value !== "string" ||
    value.length < 32 ||
    value.length > 512 ||
    /[\r\n\0]/.test(value)
  ) {
    fail("manual-send worker configuration is invalid");
  }
  return value;
}

export function loadManualSendWorkerConfig(environment = process.env) {
  if (environment.EVO_MANUAL_SEND_WORKER_ENDPOINT !== ENDPOINT) {
    fail("manual-send worker configuration is invalid");
  }
  return Object.freeze({
    endpoint: ENDPOINT,
    triggerSecret: requiredSecret(
      environment.EVO_PLATFORM_MANUAL_SEND_TRIGGER_SECRET,
    ),
    heartbeatPath: HEARTBEAT_PATH,
    intervalMs: INTERVAL_MS,
    requestTimeoutMs: REQUEST_TIMEOUT_MS,
    heartbeatMaxAgeMs: HEARTBEAT_MAX_AGE_MS,
  });
}

async function defaultWriteHeartbeat(path, value, uuid = randomUUID) {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const temporaryPath = `${path}.${uuid()}.tmp`;
  const handle = await open(temporaryPath, "wx", 0o600);
  try {
    await handle.writeFile(`${value}\n`, { encoding: "utf8" });
    await handle.sync();
  } finally {
    await handle.close();
  }
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, path);
  await chmod(path, 0o600);
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function safeResponse(value) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some(
      (key) => !["ok", "processed", "state"].includes(key),
    ) ||
    value.ok !== true ||
    typeof value.processed !== "boolean" ||
    (value.processed &&
      (typeof value.state !== "string" || value.state.length > 64)) ||
    (!value.processed && "state" in value)
  ) {
    fail("manual-send trigger returned an invalid response");
  }
  return value;
}

export function createManualSendWorker({
  config = loadManualSendWorkerConfig(),
  fetchImpl = fetch,
  randomUuid = randomUUID,
  nowMs = Date.now,
  writeHeartbeat = (value) =>
    defaultWriteHeartbeat(config.heartbeatPath, value, randomUuid),
  wait = sleep,
} = {}) {
  let inFlight = false;

  async function tick() {
    if (inFlight) fail("manual-send worker permits only one in-flight request");
    inFlight = true;
    const requestId = randomUuid().toLowerCase();
    const timestamp = String(nowMs());
    if (!UUID_PATTERN.test(requestId) || !/^\d{13}$/.test(timestamp)) {
      inFlight = false;
      fail("manual-send worker runtime identity is invalid");
    }
    const signature = createHmac("sha256", config.triggerSecret)
      .update(`${requestId}.${timestamp}`, "utf8")
      .digest("hex");
    try {
      const response = await fetchImpl(config.endpoint, {
        method: "POST",
        headers: {
          accept: "application/json",
          "x-evo-manual-send-request-id": requestId,
          "x-evo-manual-send-timestamp": timestamp,
          "x-evo-manual-send-hmac-algorithm": "sha256",
          "x-evo-manual-send-hmac": signature,
        },
        signal: AbortSignal.timeout(config.requestTimeoutMs),
      });
      if (response.status !== 200) {
        fail("manual-send trigger returned a blocking response");
      }
      const raw = await response.text();
      if (Buffer.byteLength(raw, "utf8") > 1_024) {
        fail("manual-send trigger returned an invalid response");
      }
      safeResponse(JSON.parse(raw));
      await writeHeartbeat(Number(timestamp));
      return Object.freeze({ status: "completed", httpStatus: 200 });
    } catch {
      fail("manual-send trigger became ambiguous; immediate retry is forbidden");
    } finally {
      inFlight = false;
    }
  }

  async function run() {
    for (;;) {
      await tick();
      await wait(config.intervalMs);
    }
  }

  return Object.freeze({ tick, run });
}

export async function checkManualSendHeartbeat(
  path = HEARTBEAT_PATH,
  nowMs = Date.now(),
) {
  const metadata = await stat(path);
  if (!metadata.isFile() || (metadata.mode & 0o777) !== 0o600) return false;
  return nowMs - metadata.mtimeMs <= HEARTBEAT_MAX_AGE_MS;
}

const isMain =
  process.argv[1] !== undefined &&
  pathToFileURL(fileURLToPath(import.meta.url)).href ===
    pathToFileURL(process.argv[1]).href;

if (isMain) {
  await createManualSendWorker().run();
}
