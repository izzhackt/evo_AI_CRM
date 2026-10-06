import "server-only";

import { isStaffPreview, staffCanAccessRoute, staffHasPermission } from "../platform-access.ts";
import type { ActivePlatformActor } from "../platform-auth.ts";
import { normalizeAiDocument } from "../v3/ai-agent.ts";
import {
  AI_UPLOAD_MAX_BYTES,
  checkAiUploadFile,
  isAiDocumentTitle,
  isAiLabText,
  normalizeAiDocumentDetail,
  normalizeAiLabState,
} from "../v3/ai-agent-knowledge.ts";
import {
  AI_KNOWLEDGE_BUCKET,
  aiCropPath,
  aiDocumentIdForRequest,
  aiDocumentPrefix,
  aiOriginalPath,
  aiPagePath,
  checkAiUploadContent,
  readCappedBody,
  sha256Hex,
} from "./ai-agent-files.ts";
import { aiAgentSignedHeaders, readAiAgentConfig, type AiAgentConfig } from "./ai-agent-internal-auth.ts";
import {
  agentRefusal,
  failure,
  json,
  readJsonObject,
  sameOrigin,
  streamFromAgent,
} from "./ai-agent-route-handlers.ts";
import {
  ClamdScanError,
  isClamdMalwareScanProof,
  scanBytesWithClamd,
  type ClamdMalwareScanProof,
} from "./clamd-malware-scanner.ts";

/**
 * «ИИ-агент» P2 — маршруты сотрудника для знаний и Лаборатории (план §4.5,
 * §7, §8). Браузер не видит ни Storage, ни агента:
 *
 *  - `POST /api/v3/ai-agent/documents` — загрузка (multipart): тело считается
 *    по мере прихода (≤ 25 МБ), расширение, заявленный тип и сигнатура
 *    совпадают (ZIP Office — без макросов), sha256, ClamAV (заражён — 422,
 *    сканер недоступен — 503, ничего не сохраняется), объект
 *    `{org}/{doc}/original` без перезаписи и `ai_agent_document_upload_v1`.
 *    Отказ базы — объект удаляется; неизвестный итог базы — объект остаётся
 *    для повтора тем же id запроса (id документа выводится из него);
 *  - `GET …/documents/{doc}/pages/{n}/image` и `GET …/documents/{doc}/crops/{item}` —
 *    картинка страницы и вырезка: сессия → `ai_agent_document_v1` (право
 *    чтения решает база) → поток из Storage. Путь объекта CRM строит сама
 *    по {org}/{doc}, браузерный ввод в путь не попадает;
 *  - `GET /api/v3/ai-agent/lab` — своя проверка и предложение (`ai_agent_lab_v1`);
 *  - `POST …/lab/ask`, `…/lab/critique` — билет `laboratory` и поток SSE
 *    агента; `POST …/lab/apply` — билет `lab_apply` на своё предложение и
 *    JSON агента (409 `lab_changed`, 422 `lab_edit_invalid`).
 *
 * Права решает база (Q9: все сотрудники, студенты никогда); маршрут лишь не
 * пускает без сессии, без раздела и в просмотре роли (запись и вызов агента).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const PAGE = /^[1-9]\d{0,2}$/u;
const VERSION = /^[1-9]\d{0,14}$/u;
/** Multipart: файл до 25 МБ и поля формы. */
const MULTIPART_LIMIT = AI_UPLOAD_MAX_BYTES + 64 * 1024;
const LAB_BODY_LIMIT = 16 * 1024;
const APPLY_TIMEOUT_MS = 60_000;

const IMAGE_HEADERS = Object.freeze({
  "Content-Type": "image/png",
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "default-src 'none'; sandbox",
  "Cross-Origin-Resource-Policy": "same-origin",
});

export type AiKnowledgeAccess = "read" | "agent" | "write";
export type AiKnowledgeAuthorization =
  | Readonly<{ status: "authorized"; actor: ActivePlatformActor }>
  | Readonly<{ status: "anonymous" | "forbidden" | "preview" | "unavailable"; actor: null }>;

type RpcError = Readonly<{ code?: string; message?: string; details?: string | null }>;
export type AiRpcResult = Readonly<{ data: unknown; error: RpcError | null }>;

export type AiKnowledgeStorage = Readonly<{
  /** `exists` — объект уже есть (повтор того же запроса); перезаписи нет. */
  putOriginal(path: string, bytes: Uint8Array, contentType: string): Promise<"stored" | "exists" | "failed">;
  get(path: string): Promise<Readonly<{ bytes: Uint8Array<ArrayBuffer>; contentType: string }> | "missing" | "failed">;
  remove(paths: readonly string[]): Promise<boolean>;
}>;

export type AiKnowledgeRouteDependencies = Readonly<{
  authorize(access: AiKnowledgeAccess): Promise<AiKnowledgeAuthorization>;
  /** RPC `platform.*` от имени сотрудника этой сессии. */
  rpc(name: string, args: Readonly<Record<string, unknown>>): Promise<AiRpcResult>;
  storage(): AiKnowledgeStorage;
  scan(bytes: Uint8Array): Promise<ClamdMalwareScanProof>;
  config(): AiAgentConfig | null;
  fetch: typeof fetch;
  now(): number;
}>;

function refusal(status: Exclude<AiKnowledgeAuthorization["status"], "authorized">): Response {
  if (status === "anonymous") return failure(401, "authentication_required");
  if (status === "preview") return failure(403, "preview");
  if (status === "forbidden") return failure(403, "forbidden");
  return failure(503, "unavailable");
}

async function defaultAuthorize(access: AiKnowledgeAccess): Promise<AiKnowledgeAuthorization> {
  const { resolvePlatformActor } = await import("../platform-auth.ts");
  const result = await resolvePlatformActor();
  if (result.status === "anonymous") return { status: "anonymous", actor: null };
  if (result.status === "invalid") return { status: "unavailable", actor: null };
  const actor = result.actor;
  if (!staffCanAccessRoute(actor, "/v3/ai-agent")) return { status: "forbidden", actor: null };
  // Просмотр роли видит то же, что роль, но не пишет и агента не вызывает.
  if (access !== "read" && isStaffPreview(actor)) return { status: "preview", actor: null };
  if (access === "write" && !staffHasPermission(actor, "ai.agent.manage")) return { status: "forbidden", actor: null };
  return { status: "authorized", actor };
}

function serviceStorage(): AiKnowledgeStorage {
  let client: Promise<import("@supabase/supabase-js").SupabaseClient> | null = null;
  const bucket = async () => {
    client ??= (async () => {
      const [{ getPlatformSupabaseBackendConfig }, { createPlatformSupabaseServiceClient }] = await Promise.all([
        import("./platform-supabase-backend-config.ts"), import("./platform-supabase-service-client.ts"),
      ]);
      return createPlatformSupabaseServiceClient(getPlatformSupabaseBackendConfig());
    })();
    return (await client).storage.from(AI_KNOWLEDGE_BUCKET);
  };
  return {
    async putOriginal(path, bytes, contentType) {
      try {
        const { error } = await (await bucket()).upload(path, bytes, { contentType, upsert: false });
        if (!error) return "stored";
        const status = Number((error as { statusCode?: unknown }).statusCode ?? (error as { status?: unknown }).status);
        return status === 409 || /exist/iu.test(error.message) ? "exists" : "failed";
      } catch {
        return "failed";
      }
    },
    async get(path) {
      try {
        const { data, error } = await (await bucket()).download(path);
        if (error || !data) {
          const status = Number((error as { statusCode?: unknown; status?: unknown } | null)?.statusCode
            ?? (error as { status?: unknown } | null)?.status);
          return status === 400 || status === 404 ? "missing" : "failed";
        }
        return { bytes: new Uint8Array(await data.arrayBuffer()), contentType: data.type || "application/octet-stream" };
      } catch {
        return "failed";
      }
    },
    async remove(paths) {
      try {
        const { error } = await (await bucket()).remove([...paths]);
        return !error;
      } catch {
        return false;
      }
    },
  };
}

const defaultDependencies: AiKnowledgeRouteDependencies = {
  authorize: defaultAuthorize,
  async rpc(name, args) {
    const { createSupabaseServerClient } = await import("../supabase/server.ts");
    const { data, error } = await (await createSupabaseServerClient()).schema("platform").rpc(name, args);
    return { data, error: error ? { code: error.code, message: error.message, details: error.details } : null };
  },
  storage: serviceStorage,
  scan: (bytes) => scanBytesWithClamd(bytes),
  config: () => readAiAgentConfig(),
  fetch: (...args) => fetch(...args),
  now: () => Date.now(),
};

// ------------------------------------------------------------------ upload

type UploadForm = Readonly<{
  file: File;
  title: string;
  requestId: string;
  audience: "client" | "internal" | null;
  clientConfirmed: boolean;
  replacesId: string | null;
  replacesVersion: number | null;
}>;

const NEW_FIELDS = ["file", "title", "company_material", "request_id", "audience", "client_confirmed"] as const;
const REPLACE_FIELDS = ["file", "title", "company_material", "request_id", "replaces_id", "replaces_version"] as const;

/** Поля формы — точный набор: новая загрузка или новая версия; иначе код отказа. */
function readUploadForm(form: FormData): UploadForm | string {
  const keys = [...form.keys()];
  if (new Set(keys).size !== keys.length) return "invalid_request";
  const isReplace = keys.includes("replaces_id");
  const expected: readonly string[] = isReplace ? REPLACE_FIELDS : NEW_FIELDS;
  if (keys.length !== expected.length || keys.some((key) => !expected.includes(key))) return "invalid_request";
  const file = form.get("file");
  if (!(file instanceof File)) return "invalid_request";
  const string = (key: string): string | null => {
    const value = form.get(key);
    return typeof value === "string" ? value : null;
  };
  const requestId = string("request_id");
  if (!requestId || !UUID.test(requestId)) return "invalid_request";
  // «Это материал компании, не документ клиента» — обязательно (§7).
  if (string("company_material") !== "true") return "company_material_required";
  const title = string("title")?.trim() ?? "";
  if (!isAiDocumentTitle(title)) return "invalid_title";
  if (isReplace) {
    const replacesId = string("replaces_id"), replacesVersion = string("replaces_version");
    if (!replacesId || !UUID.test(replacesId) || !replacesVersion || !VERSION.test(replacesVersion)) return "invalid_request";
    // Новая версия наследует аудиторию прежней (271): её здесь не выбирают.
    return { file, title, requestId: requestId.toLowerCase(), audience: null, clientConfirmed: false,
      replacesId: replacesId.toLowerCase(), replacesVersion: Number(replacesVersion) };
  }
  const audience = string("audience");
  if (audience !== "client" && audience !== "internal") return "invalid_request";
  const confirmed = string("client_confirmed");
  if (confirmed !== "true" && confirmed !== "false") return "invalid_request";
  if (audience === "client" && confirmed !== "true") return "client_confirmation_required";
  return { file, title, requestId: requestId.toLowerCase(), audience, clientConfirmed: confirmed === "true",
    replacesId: null, replacesVersion: null };
}

const UPLOAD_STATUS: Readonly<Record<string, number>> = {
  empty: 400, too_large: 413, macro: 415, unsupported_type: 415, type_mismatch: 415, content_mismatch: 415, text_encoding: 415,
  company_material_required: 400, client_confirmation_required: 400, invalid_title: 400, invalid_request: 400,
};

/** Отказ базы — окончательный (объект можно удалить) или нет (итог неизвестен). */
function uploadRefusal(error: RpcError): Readonly<{ final: boolean; response: Response }> {
  if (error.code === "PT409") {
    if (error.message === "ai_document_duplicate") {
      const title = typeof error.details === "string" && error.details.trim() ? error.details.slice(0, 240) : null;
      return { final: true, response: failure(409, "duplicate", { title }) };
    }
    if (error.message === "ai_document_replacement_pending") return { final: true, response: failure(409, "replacement_pending") };
    return { final: true, response: failure(409, "conflict") };
  }
  if (error.code === "42501") return { final: true, response: failure(403, "forbidden") };
  if (error.code === "P0002") return { final: true, response: failure(404, "not_found") };
  if (error.code === "22023" || error.code === "23514") {
    if (error.message === "ai_document_company_material_required") return { final: true, response: failure(400, "company_material_required") };
    if (error.message === "ai_document_client_confirmation_required") return { final: true, response: failure(400, "client_confirmation_required") };
    return { final: true, response: failure(400, "invalid_request") };
  }
  return { final: false, response: failure(503, "unavailable") };
}

export function createAiDocumentUploadHandler(dependencies: AiKnowledgeRouteDependencies = defaultDependencies) {
  return async function POST(request: Request): Promise<Response> {
    try {
      if (!sameOrigin(request)) return failure(403, "forbidden");
      const authorization = await dependencies.authorize("write");
      if (authorization.status !== "authorized") return refusal(authorization.status);
      const actor = authorization.actor;
      const contentType = request.headers.get("content-type") ?? "";
      if (!/^multipart\/form-data;\s*boundary=/iu.test(contentType)) return failure(415, "multipart_required");

      const body = await readCappedBody(request, MULTIPART_LIMIT);
      if (body === "too_large") return failure(413, "too_large");
      if (body === "unreadable") return failure(400, "invalid_request");
      let form: FormData;
      try {
        form = await new Response(body, { headers: { "Content-Type": contentType } }).formData();
      } catch {
        return failure(400, "invalid_request");
      }
      const upload = readUploadForm(form);
      if (typeof upload === "string") return failure(UPLOAD_STATUS[upload] ?? 400, upload);

      const check = checkAiUploadFile(upload.file.name, upload.file.type, upload.file.size);
      if (!check.ok) return failure(UPLOAD_STATUS[check.code] ?? 415, check.code);
      const bytes = new Uint8Array(await upload.file.arrayBuffer());
      if (bytes.byteLength !== upload.file.size || bytes.byteLength > AI_UPLOAD_MAX_BYTES) return failure(413, "too_large");
      const content = checkAiUploadContent(check.format, bytes);
      if (!content.ok) return failure(415, content.code);
      const sha256 = sha256Hex(bytes);

      // Проверка на вирусы до того, как файл ляжет в Storage.
      let proof: ClamdMalwareScanProof;
      try {
        proof = await dependencies.scan(bytes);
      } catch (error) {
        if (error instanceof ClamdScanError && error.code === "infected") return failure(422, "malware_detected");
        return failure(503, "malware_scanner_unavailable");
      }
      if (!isClamdMalwareScanProof(proof, sha256)) return failure(503, "malware_scanner_unavailable");

      const documentId = aiDocumentIdForRequest(actor.organizationId, upload.requestId);
      const path = aiOriginalPath(actor.organizationId, documentId);
      const storage = dependencies.storage();
      const stored = await storage.putOriginal(path, bytes, check.format.mimeType);
      if (stored === "failed") return failure(503, "storage_unavailable");

      const { data, error } = await dependencies.rpc("ai_agent_document_upload_v1", {
        p_organization_id: actor.organizationId,
        p_document_id: documentId,
        p_title: upload.title,
        p_kind: check.format.kind,
        p_mime_type: check.format.mimeType,
        p_byte_size: bytes.byteLength,
        p_byte_sha256: sha256,
        p_audience: upload.audience,
        p_client_confirmed: upload.clientConfirmed,
        p_company_material: true,
        p_replaces_id: upload.replacesId,
        p_replaces_version: upload.replacesVersion,
        // Доказательство ClamAV как есть (271 сверяет ключи, протокол, sha256 и свежесть).
        p_scan_proof: {
          engine: proof.engine, engineVersion: proof.engineVersion, signatureVersion: proof.signatureVersion,
          protocol: proof.protocol, scannedAt: proof.scannedAt, sha256Hex: proof.sha256Hex,
        },
        p_request_id: upload.requestId,
      });
      if (error) {
        const { final, response } = uploadRefusal(error);
        // Свой новый объект при окончательном отказе удаляется; объект
        // прежней попытки того же запроса (`exists`) не трогается.
        if (final && stored === "stored") await storage.remove([path]);
        return response;
      }
      const receipt = typeof data === "object" && data !== null ? data as Record<string, unknown> : {};
      let document: ReturnType<typeof normalizeAiDocument> | null = null;
      try {
        document = normalizeAiDocument(receipt.document);
      } catch {
        document = null;
      }
      return json(201, { documentId, document });
    } catch {
      return failure(503, "unavailable");
    }
  };
}

// ------------------------------------------------------------------ images

type PageContext = Readonly<{ params: Promise<Readonly<{ documentId: string; page: string }>> }>;
type CropContext = Readonly<{ params: Promise<Readonly<{ documentId: string; itemId: string }>> }>;

/** Документ читается этой сессией (`ai_agent_document_v1`): решает база. */
async function readableDocument(dependencies: AiKnowledgeRouteDependencies, actor: ActivePlatformActor, documentId: string) {
  const { data, error } = await dependencies.rpc("ai_agent_document_v1", {
    p_organization_id: actor.organizationId, p_document_id: documentId,
  });
  if (error) {
    if (error.code === "42501") return "forbidden" as const;
    if (error.code === "P0002") return "missing" as const;
    return "unavailable" as const;
  }
  try {
    const detail = normalizeAiDocumentDetail(data);
    return detail.document.id === documentId ? detail : "unavailable" as const;
  } catch {
    return "unavailable" as const;
  }
}

async function streamImage(storage: AiKnowledgeStorage, path: string): Promise<Response> {
  const object = await storage.get(path);
  if (object === "missing") return failure(404, "not_found");
  if (object === "failed") return failure(503, "unavailable");
  // Агент кладёт сюда только PNG (брокер проверяет сигнатуру); иное не отдаётся.
  const png = object.bytes.length >= 8 && object.bytes[0] === 0x89 && object.bytes[1] === 0x50
    && object.bytes[2] === 0x4e && object.bytes[3] === 0x47;
  if (!png) return failure(404, "not_found");
  return new Response(object.bytes, { status: 200, headers: { ...IMAGE_HEADERS, "Content-Length": String(object.bytes.byteLength) } });
}

export function createAiDocumentPageImageHandler(dependencies: AiKnowledgeRouteDependencies = defaultDependencies) {
  return async function GET(_request: Request, context: PageContext): Promise<Response> {
    try {
      const authorization = await dependencies.authorize("read");
      if (authorization.status !== "authorized") return refusal(authorization.status);
      const params = await context.params;
      if (!UUID.test(params.documentId) || !PAGE.test(params.page) || Number(params.page) > 300) return failure(404, "not_found");
      const documentId = params.documentId.toLowerCase(), pageNo = Number(params.page);
      const detail = await readableDocument(dependencies, authorization.actor, documentId);
      if (detail === "forbidden") return failure(403, "forbidden");
      if (detail === "missing") return failure(404, "not_found");
      if (detail === "unavailable") return failure(503, "unavailable");
      if (!detail.pages.some((page) => page.pageNo === pageNo && page.hasImage)) return failure(404, "not_found");
      return await streamImage(dependencies.storage(), aiPagePath(authorization.actor.organizationId, documentId, pageNo));
    } catch {
      return failure(503, "unavailable");
    }
  };
}

export function createAiReviewCropHandler(dependencies: AiKnowledgeRouteDependencies = defaultDependencies) {
  return async function GET(_request: Request, context: CropContext): Promise<Response> {
    try {
      const authorization = await dependencies.authorize("read");
      if (authorization.status !== "authorized") return refusal(authorization.status);
      const params = await context.params;
      if (!UUID.test(params.documentId) || !UUID.test(params.itemId)) return failure(404, "not_found");
      const documentId = params.documentId.toLowerCase();
      const detail = await readableDocument(dependencies, authorization.actor, documentId);
      if (detail === "forbidden") return failure(403, "forbidden");
      if (detail === "missing") return failure(404, "not_found");
      if (detail === "unavailable") return failure(503, "unavailable");
      // Вырезка лежит под префиксом своего документа: право на документ —
      // право на его вырезки; чужой документ сюда не попадёт по построению пути.
      const path = aiCropPath(authorization.actor.organizationId, documentId, params.itemId.toLowerCase());
      if (!path.startsWith(aiDocumentPrefix(authorization.actor.organizationId, documentId))) return failure(404, "not_found");
      return await streamImage(dependencies.storage(), path);
    } catch {
      return failure(503, "unavailable");
    }
  };
}

// ------------------------------------------------------------------ laboratory

type TicketPurpose = "laboratory" | "lab_apply";

async function issueTicket(
  dependencies: AiKnowledgeRouteDependencies,
  actor: ActivePlatformActor,
  purpose: TicketPurpose,
  refId: string | null,
): Promise<Readonly<{ ticket: string }> | Response> {
  const { data, error } = await dependencies.rpc("ai_agent_ticket_v1", {
    p_organization_id: actor.organizationId, p_purpose: purpose, p_conversation_id: null, p_ref_id: refId,
  });
  if (error) {
    if (error.code === "PT412") return failure(412, "consent_required");
    if (error.code === "PT429") return failure(429, "rate_limited");
    if (error.code === "42501") return failure(403, "forbidden");
    // Предложение уже не «предложено», чужое или истекло — «изменились, спросите заново».
    if (purpose === "lab_apply" && (error.code === "PT409" || error.code === "22023" || error.code === "P0002")) {
      return failure(409, "lab_changed");
    }
    return failure(503, "unavailable");
  }
  const ticket = typeof data === "object" && data !== null ? (data as Record<string, unknown>).ticket : null;
  return typeof ticket === "string" && /^[0-9a-f]{64}$/u.test(ticket) ? { ticket } : failure(503, "unavailable");
}

export function createAiLabStateHandler(dependencies: AiKnowledgeRouteDependencies = defaultDependencies) {
  return async function GET(request: Request): Promise<Response> {
    try {
      const authorization = await dependencies.authorize("read");
      if (authorization.status !== "authorized") return refusal(authorization.status);
      if (new URL(request.url).search !== "") return failure(400, "invalid_request");
      const { data, error } = await dependencies.rpc("ai_agent_lab_v1", { p_organization_id: authorization.actor.organizationId });
      if (error) return failure(error.code === "42501" ? 403 : 503, error.code === "42501" ? "forbidden" : "unavailable");
      return json(200, { state: normalizeAiLabState(data), featureOn: dependencies.config() !== null });
    } catch {
      return failure(503, "unavailable");
    }
  };
}

/** «Спросите как клиент» и «Что не так?» — билет `laboratory` и поток агента. */
function createLabStreamHandler(kind: "ask" | "critique", dependencies: AiKnowledgeRouteDependencies) {
  const field = kind === "ask" ? "question" : "finding";
  return async function POST(request: Request): Promise<Response> {
    try {
      if (!sameOrigin(request)) return failure(403, "forbidden");
      const authorization = await dependencies.authorize("agent");
      if (authorization.status !== "authorized") return refusal(authorization.status);
      const body = await readJsonObject(request, [field], LAB_BODY_LIMIT);
      const value = body?.[field];
      if (typeof value !== "string" || !isAiLabText(value)) return failure(400, "invalid_request");
      const config = dependencies.config();
      if (!config) return failure(503, "ai_agent_off");
      const ticket = await issueTicket(dependencies, authorization.actor, "laboratory", null);
      if (ticket instanceof Response) return ticket;
      return await streamFromAgent(request, config, `/v1/lab/${kind}`,
        JSON.stringify({ ticket: ticket.ticket, [field]: value.trim() }), dependencies);
    } catch {
      return failure(503, "unavailable");
    }
  };
}

export function createAiLabAskHandler(dependencies: AiKnowledgeRouteDependencies = defaultDependencies) {
  return createLabStreamHandler("ask", dependencies);
}
export function createAiLabCritiqueHandler(dependencies: AiKnowledgeRouteDependencies = defaultDependencies) {
  return createLabStreamHandler("critique", dependencies);
}

/**
 * «Применить» (§8): билет `lab_apply` на своё предложение (база проверяет
 * автора и `manage`), агент готовит эмбеддинги вне транзакции и вызывает
 * `lab_apply_v1` — одна транзакция перепроверяет знания и предложение.
 */
export function createAiLabApplyHandler(dependencies: AiKnowledgeRouteDependencies = defaultDependencies) {
  return async function POST(request: Request): Promise<Response> {
    try {
      if (!sameOrigin(request)) return failure(403, "forbidden");
      const authorization = await dependencies.authorize("write");
      if (authorization.status !== "authorized") return refusal(authorization.status);
      const body = await readJsonObject(request, ["proposalId"]);
      const proposalId = typeof body?.proposalId === "string" && UUID.test(body.proposalId) ? body.proposalId.toLowerCase() : null;
      if (!proposalId) return failure(400, "invalid_request");
      const config = dependencies.config();
      if (!config) return failure(503, "ai_agent_off");
      const ticket = await issueTicket(dependencies, authorization.actor, "lab_apply", proposalId);
      if (ticket instanceof Response) return ticket;
      const path = "/v1/lab/apply";
      const payload = JSON.stringify({ ticket: ticket.ticket });
      let upstream: Response;
      try {
        upstream = await dependencies.fetch(`${config.baseUrl}${path}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            ...aiAgentSignedHeaders(config, "POST", path, payload, dependencies.now()),
          },
          body: payload,
          signal: AbortSignal.any([request.signal, AbortSignal.timeout(APPLY_TIMEOUT_MS)]),
          redirect: "error",
          cache: "no-store",
        });
      } catch {
        return failure(503, "agent_unavailable");
      }
      if (upstream.status !== 200) return agentRefusal(upstream);
      let result: Record<string, unknown> = {};
      try {
        const parsed = await upstream.json() as unknown;
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) result = parsed as Record<string, unknown>;
      } catch {
        return failure(503, "agent_unavailable");
      }
      const kind = ["document", "knowledge", "rules", "example"].includes(String(result.kind)) ? String(result.kind) : null;
      const documentId = typeof result.documentId === "string" && UUID.test(result.documentId) ? result.documentId.toLowerCase() : null;
      return json(200, { status: "applied", kind, documentId });
    } catch {
      return failure(503, "unavailable");
    }
  };
}
