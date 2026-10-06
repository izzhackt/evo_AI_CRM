import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import {
  AI_BROKER_IMAGE_MAX_BYTES,
  AI_BROKER_IMAGE_MAX_SIDE,
  AI_KNOWLEDGE_BUCKET,
  pngSize,
  readCappedBody,
} from "./ai-agent-files.ts";
import { AI_AGENT_SIGNATURE_HEADER, AI_AGENT_TIMESTAMP_HEADER } from "./ai-agent-internal-auth.ts";

/**
 * Внутренний брокер Storage для приватного агента (план §4.5, P2):
 *
 *   GET /api/internal/ai-agent/storage/{org}/{doc}/original        — оригинал;
 *   GET /api/internal/ai-agent/storage/{org}/{doc}/pages/{n}.png   — страница;
 *   PUT /api/internal/ai-agent/storage/{org}/{doc}/pages/{n}.png   — отрисовка страницы;
 *   PUT /api/internal/ai-agent/storage/{org}/{doc}/crops/{item}.png — вырезка «Листа сверки».
 *
 * Больше ничего: ни DELETE, ни списка, ни подписанных ссылок, ни других
 * bucket. Серверный ключ Supabase остаётся у CRM; агент знает только свой
 * секрет брокера `EVO_AI_AGENT_STORAGE_SECRET` (не секрет вызовов агента):
 *
 *   X-EVO-AI-Timestamp: <unix seconds>   (±60 с)
 *   X-EVO-AI-Worker:    <worker ref>      (тот, кто держит аренду документа)
 *   X-EVO-AI-Signature: hex(HMAC_SHA256(secret, "<ts>.<METHOD>.<path>.<worker ref>.<sha256 hex of body>"))
 *
 * Ссылка воркера входит в подпись: от неё зависит проверка аренды, и
 * подменить её в чужом запросе нельзя. Повтор того же запроса в окне ±60 с
 * подпись не отличит: GET отдаёт тот же объект тому же воркеру, PUT
 * перезаписывает те же байты (страницы и вырезки — производные, upsert).
 *
 * Подпись одна не открывает документ: затем `ai_agent_storage_authorize_v1`
 * (только service_role) пускает путь под `{org}/{doc}/`, если операция
 * подходит объекту и этот воркер держит аренду документа. Маршрут доступен
 * только во внутренней сети `evo_crm_ai`; edge Caddy отвечает 404 на
 * `/api/internal/*`.
 */
export const AI_STORAGE_WORKER_HEADER = "X-EVO-AI-Worker";
export const AI_STORAGE_CLOCK_SKEW_SECONDS = 60;
const ROUTE_PREFIX = "/api/internal/ai-agent/storage/";
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
/** Тот же путь — в контракте прокси (`platform-route-contract.ts`). */
export const AI_STORAGE_BROKER_PATH = new RegExp(
  `^${ROUTE_PREFIX}(${UUID})/(${UUID})/(original|pages/([1-9][0-9]{0,2})\\.png|crops/(${UUID})\\.png)$`,
  "u",
);
const WORKER = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,199}$/u;
const ORIGINAL_TYPES = new Set([
  "application/pdf", "text/plain", "text/csv", "text/markdown", "image/png", "image/jpeg",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);
const HEADERS = Object.freeze({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });

export type AiBrokerObject =
  | Readonly<{ kind: "original" }>
  | Readonly<{ kind: "page"; pageNo: number }>
  | Readonly<{ kind: "crop"; itemId: string }>;

export type AiBrokerTarget = Readonly<{
  organizationId: string;
  documentId: string;
  object: AiBrokerObject;
  /** Путь объекта в bucket: `{org}/{doc}/…`. */
  objectPath: string;
}>;

/** Строгий разбор пути; всё прочее (регистр, `..`, `%2F`, лишний слэш) — null. */
export function parseAiBrokerPath(pathname: string): AiBrokerTarget | null {
  const match = AI_STORAGE_BROKER_PATH.exec(pathname);
  if (!match) return null;
  const [, organizationId, documentId, objectName, page, item] = match;
  const pageNo = page === undefined ? null : Number(page);
  if (pageNo !== null && pageNo > 300) return null;
  const object: AiBrokerObject = objectName === "original" ? { kind: "original" }
    : pageNo !== null ? { kind: "page", pageNo } : { kind: "crop", itemId: item! };
  return Object.freeze({ organizationId: organizationId!, documentId: documentId!, object, objectPath: `${organizationId}/${documentId}/${objectName}` });
}

/** Секрет брокера: 32–256 печатных знаков и не равен секрету вызовов агента; иначе брокер выключен. */
export function readAiStorageSecret(env: Readonly<Record<string, string | undefined>> = process.env): string | null {
  const secret = (env.EVO_AI_AGENT_STORAGE_SECRET ?? "").trim();
  if (!/^[\x21-\x7e]{32,256}$/u.test(secret)) return null;
  if (secret === (env.EVO_AI_AGENT_INTERNAL_SECRET ?? "").trim()) return null;
  return secret;
}

export function signAiStorageRequest(
  secret: string, timestamp: string, method: string, path: string, workerRef: string, body: Uint8Array,
): string {
  const digest = createHash("sha256").update(body).digest("hex");
  return createHmac("sha256", secret).update(`${timestamp}.${method.toUpperCase()}.${path}.${workerRef}.${digest}`).digest("hex");
}

export type AiBrokerAuthorization = "allowed" | "denied" | "missing" | "unavailable";

export type AiStorageBrokerDependencies = Readonly<{
  secret(): string | null;
  /** `ai_agent_storage_authorize_v1` от service_role: аренда и операция решает база. */
  authorize(target: AiBrokerTarget, workerRef: string, method: "GET" | "PUT"): Promise<AiBrokerAuthorization>;
  get(objectPath: string): Promise<Readonly<{ bytes: Uint8Array<ArrayBuffer>; contentType: string }> | "missing" | "failed">;
  put(objectPath: string, bytes: Uint8Array, contentType: "image/png"): Promise<boolean>;
  now(): number;
}>;

async function serviceClient() {
  const [{ getPlatformSupabaseBackendConfig }, { createPlatformSupabaseServiceClient }] = await Promise.all([
    import("./platform-supabase-backend-config.ts"), import("./platform-supabase-service-client.ts"),
  ]);
  return createPlatformSupabaseServiceClient(getPlatformSupabaseBackendConfig());
}

const defaultDependencies: AiStorageBrokerDependencies = {
  secret: () => readAiStorageSecret(),
  async authorize(target, workerRef, method) {
    try {
      const { data, error } = await (await serviceClient()).schema("platform").rpc("ai_agent_storage_authorize_v1", {
        p_organization_id: target.organizationId, p_document_id: target.documentId, p_worker_ref: workerRef,
        p_op: method, p_path: target.objectPath,
      });
      if (error) {
        if (error.code === "P0002") return "missing";
        return error.code === "42501" || error.code === "PT423" || error.code === "22023" ? "denied" : "unavailable";
      }
      const allowed = typeof data === "object" && data !== null ? (data as Record<string, unknown>).allowed : data;
      return allowed === true ? "allowed" : "denied";
    } catch {
      return "unavailable";
    }
  },
  async get(objectPath) {
    try {
      const { data, error } = await (await serviceClient()).storage.from(AI_KNOWLEDGE_BUCKET).download(objectPath);
      if (error || !data) {
        const status = Number((error as { statusCode?: unknown; status?: unknown } | null)?.statusCode
          ?? (error as { status?: unknown } | null)?.status);
        return status === 400 || status === 404 ? "missing" : "failed";
      }
      return { bytes: new Uint8Array(await data.arrayBuffer()), contentType: data.type };
    } catch {
      return "failed";
    }
  },
  async put(objectPath, bytes, contentType) {
    try {
      // Страницы и вырезки — производные агента: повтор обработки перерисовывает их.
      const { error } = await (await serviceClient()).storage.from(AI_KNOWLEDGE_BUCKET)
        .upload(objectPath, bytes, { contentType, upsert: true });
      return !error;
    } catch {
      return false;
    }
  },
  now: () => Date.now(),
};

function refuse(status: number, code: string, extra: Record<string, string> = {}): Response {
  return Response.json({ error: { code } }, { status, headers: { ...HEADERS, ...extra } });
}

function signatureMatches(expected: string, given: string): boolean {
  if (!/^[0-9a-f]{64}$/u.test(given)) return false;
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(given, "hex"));
}

/** Какие методы есть у объекта: оригинал читается, страница читается и пишется, вырезка пишется. */
function allowedMethods(object: AiBrokerObject): readonly ("GET" | "PUT")[] {
  if (object.kind === "original") return ["GET"];
  if (object.kind === "page") return ["GET", "PUT"];
  return ["PUT"];
}

export function createAiStorageBrokerHandler(dependencies: AiStorageBrokerDependencies = defaultDependencies) {
  return async function handle(request: Request): Promise<Response> {
    try {
      const secret = dependencies.secret();
      if (!secret) return refuse(503, "storage_broker_off");
      const url = new URL(request.url);
      const target = url.search === "" ? parseAiBrokerPath(url.pathname) : null;
      if (!target) return refuse(404, "not_found");
      const methods = allowedMethods(target.object);
      const method = request.method.toUpperCase();
      if (method !== "GET" && method !== "PUT") return refuse(405, "method_not_allowed", { Allow: methods.join(", ") });
      if (!methods.includes(method)) return refuse(405, "method_not_allowed", { Allow: methods.join(", ") });

      const timestamp = request.headers.get(AI_AGENT_TIMESTAMP_HEADER)?.trim() ?? "";
      const signature = request.headers.get(AI_AGENT_SIGNATURE_HEADER)?.trim().toLowerCase() ?? "";
      const workerRef = request.headers.get(AI_STORAGE_WORKER_HEADER)?.trim() ?? "";
      if (!/^\d{1,12}$/u.test(timestamp) || !signature || !WORKER.test(workerRef)) return refuse(401, "unauthorized");
      if (Math.abs(dependencies.now() / 1000 - Number(timestamp)) > AI_STORAGE_CLOCK_SKEW_SECONDS) return refuse(401, "unauthorized");

      let body: Uint8Array<ArrayBuffer> = new Uint8Array(0);
      if (method === "PUT") {
        if ((request.headers.get("content-type") ?? "").split(";", 1)[0]!.trim().toLowerCase() !== "image/png") {
          return refuse(415, "png_required");
        }
        const read = await readCappedBody(request, AI_BROKER_IMAGE_MAX_BYTES);
        if (read === "too_large") return refuse(413, "too_large");
        if (read === "unreadable") return refuse(400, "invalid_request");
        body = read;
      } else {
        const read = await readCappedBody(request, 0);
        if (read === "too_large" || read === "unreadable") return refuse(400, "invalid_request");
      }
      if (!signatureMatches(signAiStorageRequest(secret, timestamp, method, url.pathname, workerRef, body), signature)) {
        return refuse(401, "unauthorized");
      }
      if (method === "PUT") {
        const size = pngSize(body);
        if (!size) return refuse(415, "png_required");
        if (size.width > AI_BROKER_IMAGE_MAX_SIDE || size.height > AI_BROKER_IMAGE_MAX_SIDE) return refuse(422, "image_too_large");
      }

      const decision = await dependencies.authorize(target, workerRef, method);
      if (decision === "denied") return refuse(403, "forbidden");
      if (decision === "missing") return refuse(404, "not_found");
      if (decision !== "allowed") return refuse(503, "unavailable");

      if (method === "PUT") {
        return await dependencies.put(target.objectPath, body, "image/png")
          ? new Response(null, { status: 204, headers: HEADERS }) : refuse(503, "unavailable");
      }
      const object = await dependencies.get(target.objectPath);
      if (object === "missing") return refuse(404, "not_found");
      if (object === "failed") return refuse(503, "unavailable");
      const type = target.object.kind === "page" ? "image/png"
        : ORIGINAL_TYPES.has(object.contentType.split(";", 1)[0]!.trim().toLowerCase()) ? object.contentType : "application/octet-stream";
      return new Response(object.bytes, {
        status: 200,
        headers: { ...HEADERS, "Content-Type": type, "Content-Length": String(object.bytes.byteLength) },
      });
    } catch {
      return refuse(503, "unavailable");
    }
  };
}
