import {
  loadPlatformStaffAssistantConfig,
  type PlatformStaffAssistantConfig,
  type PlatformStaffAssistantEnabledConfig,
} from "../../../../lib/server/platform-staff-assistant-config.ts";
import {
  normalizePlatformStaffAssistantInput,
  normalizePlatformStaffAssistantResult,
  PLATFORM_STAFF_ASSISTANT_MAX_BODY_BYTES,
  PlatformStaffAssistantContractError,
  type PlatformStaffAssistantInput,
  type PlatformStaffAssistantResult,
} from "../../../../lib/server/platform-staff-assistant-contract.ts";

type ActorResult =
  | Readonly<{ status: "anonymous" | "invalid"; actor: null }>
  | Readonly<{
      status: "authenticated";
      actor: Readonly<{
        authUserId: string;
        organizationId: string;
        platformRole:
          | "admin"
          | "sales"
          | "admissions"
          | "curator"
          | "finance"
          | "student";
      }>;
    }>;

type DraftInput = Readonly<{
  config: PlatformStaffAssistantEnabledConfig;
  actorUserId: string;
  accountId: string;
  input: PlatformStaffAssistantInput;
}>;

type Dependencies = Readonly<{
  config: PlatformStaffAssistantConfig;
  loadActor(): Promise<ActorResult>;
  createDraft(input: DraftInput): Promise<PlatformStaffAssistantResult>;
}>;

type DependenciesLoader = () => Promise<Dependencies>;

type ErrorCode =
  | "invalid_request"
  | "auth_required"
  | "forbidden"
  | "method_not_allowed"
  | "request_too_large"
  | "unsupported_media_type"
  | "rate_limited"
  | "knowledge_unavailable"
  | "provider_unavailable"
  | "audit_unavailable"
  | "assistant_disabled";

const RESPONSE_HEADERS = {
  "cache-control": "private, no-store",
  "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff",
};

function jsonResponse(status: number, body: unknown, allowPost = false): Response {
  const headers = new Headers(RESPONSE_HEADERS);
  if (allowPost) headers.set("allow", "POST");
  return new Response(JSON.stringify(body), { status, headers });
}

function errorResponse(status: number, code: ErrorCode, allowPost = false): Response {
  return jsonResponse(status, { error: { code } }, allowPost);
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host")?.trim().toLowerCase();
  if (!origin || !host || host.includes(",") || /\s/u.test(host)) return false;
  try {
    const parsed = new URL(origin);
    if (origin !== parsed.origin || parsed.host.toLowerCase() !== host) return false;
    const forwardedProto = request.headers.get("x-forwarded-proto")?.trim();
    if (forwardedProto && !/^(?:http|https)$/u.test(forwardedProto)) return false;
    return parsed.protocol === (forwardedProto ? `${forwardedProto}:` : new URL(request.url).protocol);
  } catch {
    return false;
  }
}

async function readBoundedJson(request: Request): Promise<unknown> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null && (!/^\d+$/u.test(declaredLength) || Number(declaredLength) > PLATFORM_STAFF_ASSISTANT_MAX_BODY_BYTES)) {
    throw new RangeError("request_too_large");
  }
  if (!request.body) throw new PlatformStaffAssistantContractError();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > PLATFORM_STAFF_ASSISTANT_MAX_BODY_BYTES) {
      await reader.cancel();
      throw new RangeError("request_too_large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  return JSON.parse(text) as unknown;
}

async function defaultDependencies(): Promise<Dependencies> {
  const config = loadPlatformStaffAssistantConfig();
  if (!config.enabled) {
    return {
      config,
      loadActor: async () => ({ status: "anonymous", actor: null }),
      createDraft: async () => {
        throw new Error("assistant disabled");
      },
    };
  }
  const [{ resolvePlatformActor }, { createPlatformStaffAssistantRuntime }] = await Promise.all([
    import("../../../../lib/platform-auth.ts"),
    import("../../../../lib/server/platform-staff-assistant-service.ts"),
  ]);
  const runtime = createPlatformStaffAssistantRuntime(config);
  return {
    config,
    loadActor: resolvePlatformActor,
    createDraft: runtime.createDraft,
  };
}

export function createPlatformStaffAssistantHandler(loadDependencies: DependenciesLoader = defaultDependencies) {
  return async function handler(request: Request): Promise<Response> {
    if (request.method !== "POST") return errorResponse(405, "method_not_allowed", true);
    if (!sameOrigin(request)) return errorResponse(403, "forbidden");
    if (request.headers.get("content-type") !== "application/json") return errorResponse(415, "unsupported_media_type");
    const declaredLength = request.headers.get("content-length");
    if (declaredLength !== null && (!/^\d+$/u.test(declaredLength) || Number(declaredLength) > PLATFORM_STAFF_ASSISTANT_MAX_BODY_BYTES)) {
      return errorResponse(413, "request_too_large");
    }

    let dependencies: Dependencies;
    try {
      dependencies = await loadDependencies();
    } catch {
      return errorResponse(503, "assistant_disabled");
    }
    if (!dependencies.config.enabled) return errorResponse(503, "assistant_disabled");

    let input: PlatformStaffAssistantInput;
    try {
      input = normalizePlatformStaffAssistantInput(await readBoundedJson(request));
    } catch (error) {
      if (error instanceof RangeError) return errorResponse(413, "request_too_large");
      return errorResponse(400, "invalid_request");
    }

    let actor: ActorResult;
    try {
      actor = await dependencies.loadActor();
    } catch {
      return errorResponse(403, "forbidden");
    }
    if (actor.status === "anonymous") return errorResponse(401, "auth_required");
    if (actor.status !== "authenticated") return errorResponse(403, "forbidden");
    if (actor.actor.organizationId !== dependencies.config.organizationId) return errorResponse(403, "forbidden");
    if (!["admin", "sales", "curator"].includes(actor.actor.platformRole)) return errorResponse(403, "forbidden");

    try {
      const result = normalizePlatformStaffAssistantResult(await dependencies.createDraft({
        config: dependencies.config,
        actorUserId: actor.actor.authUserId,
        accountId: dependencies.config.accountId,
        input,
      }));
      return jsonResponse(200, result);
    } catch (error) {
      const code = error instanceof Error ? error.name : "";
      if (code === "PlatformStaffAssistantRateLimitError") return errorResponse(429, "rate_limited");
      if (code === "PlatformStaffKnowledgeError") return errorResponse(503, "knowledge_unavailable");
      if (code === "PlatformStaffAssistantAuditError") return errorResponse(503, "audit_unavailable");
      return errorResponse(502, "provider_unavailable");
    }
  };
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = createPlatformStaffAssistantHandler();
export const GET = POST;
export const HEAD = POST;
export const OPTIONS = POST;
export const PUT = POST;
export const PATCH = POST;
export const DELETE = POST;
