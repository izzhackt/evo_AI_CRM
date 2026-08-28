import { isPlatformP7AAuditEnabled } from "../../../../lib/platform-audit-config.ts";
import {
  PLATFORM_AUDIT_EXPORT_INPUT_FIELDS,
  normalizePlatformAuditExportInput,
  PlatformAuditContractError,
  type PlatformAuditExportInput,
  type PlatformAuditExportResult,
} from "../../../../lib/platform-audit.ts";
import { serializePlatformAuditCsv } from "../../../../lib/platform-audit-csv.ts";
import {
  createPlatformAuditRepository,
  PlatformAuditRepositoryError,
  type PlatformAuditRpcClient,
} from "../../../../lib/platform-audit-repository.ts";

const MAX_FORM_BODY_BYTES = 16_384;
const CONTENT_TYPE = "application/x-www-form-urlencoded";
const RESPONSE_HEADERS = {
  "cache-control": "private, no-store",
  "x-content-type-options": "nosniff",
};

type ExportActorResult =
  Awaited<ReturnType<typeof import("../../../../lib/platform-auth").resolvePlatformActor>>;

type PlatformAuditExportRouteDependencies = Readonly<{
  env: Readonly<Record<string, string | undefined>>;
  loadActor(): Promise<ExportActorResult>;
  exportAudit(input: PlatformAuditExportInput): Promise<PlatformAuditExportResult>;
}>;

type DependenciesLoader = () => Promise<PlatformAuditExportRouteDependencies>;

function response(status: 400 | 403 | 405 | 503): Response {
  const headers = new Headers(RESPONSE_HEADERS);
  if (status === 405) headers.set("allow", "POST");
  return new Response(null, { status, headers });
}

export async function methodNotAllowed(): Promise<Response> {
  return response(405);
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const parsedOrigin = new URL(origin);
    if (origin !== parsedOrigin.origin) return false;

    const host = request.headers.get("host")?.trim();
    if (!host || host.includes(",") || /\s/u.test(host)) return false;
    if (parsedOrigin.host !== host.toLowerCase()) return false;

    const forwardedProto = request.headers.get("x-forwarded-proto")?.trim();
    if (forwardedProto !== undefined && !/^(?:http|https)$/u.test(forwardedProto)) {
      return false;
    }
    const protocol = forwardedProto
      ? `${forwardedProto}:`
      : new URL(request.url).protocol;
    return parsedOrigin.protocol === protocol;
  } catch {
    return false;
  }
}

function hasExactContentType(request: Request): boolean {
  return request.headers.get("content-type") === CONTENT_TYPE;
}

function contentLengthWithinLimit(request: Request): boolean {
  const raw = request.headers.get("content-length");
  if (raw === null) return true;
  return /^\d+$/u.test(raw) && Number(raw) <= MAX_FORM_BODY_BYTES;
}

function parseExactForm(body: string): Record<string, string> | null {
  if (
    body.length === 0 ||
    body.endsWith("&") ||
    Buffer.byteLength(body, "utf8") > MAX_FORM_BODY_BYTES
  ) {
    return null;
  }
  const params = new URLSearchParams(body);
  const allowed = new Set(PLATFORM_AUDIT_EXPORT_INPUT_FIELDS);
  const result: Record<string, string> = {};
  for (const key of new Set(params.keys())) {
    if (!allowed.has(key as (typeof PLATFORM_AUDIT_EXPORT_INPUT_FIELDS)[number])) {
      return null;
    }
    const values = params.getAll(key);
    if (values.length !== 1) return null;
    result[key] = values[0];
  }
  // Required export fields cannot be inferred by the route or RPC.
  if (!("request_id" in result) || !("start_at" in result) || !("end_at" in result)) {
    return null;
  }
  return result;
}

async function readBoundedUtf8Body(request: Request): Promise<string | null> {
  if (request.body === null) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_FORM_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    try {
      await reader.cancel();
    } catch {
      // The body is already unusable; cancellation is best effort only.
    }
    return null;
  }
}

async function defaultDependencies(): Promise<PlatformAuditExportRouteDependencies> {
  const [{ resolvePlatformActor }, { createSupabaseServerContext }] = await Promise.all([
    import("../../../../lib/platform-auth"),
    import("../../../../lib/supabase/server"),
  ]);
  const context = await createSupabaseServerContext();
  const repository = createPlatformAuditRepository(
    context.client as unknown as PlatformAuditRpcClient,
  );
  return {
    env: process.env,
    loadActor: resolvePlatformActor,
    exportAudit: (input) => repository.export(input),
  };
}

export function createPlatformAuditExportHandler(
  loadDependencies: DependenciesLoader = defaultDependencies,
): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    if (request.method !== "POST") return response(405);
    if (!sameOrigin(request)) return response(403);
    if (!hasExactContentType(request) || !contentLengthWithinLimit(request)) {
      return response(400);
    }

    const body = await readBoundedUtf8Body(request);
    if (body === null) return response(400);
    const form = parseExactForm(body);
    if (form === null) return response(400);

    let input: PlatformAuditExportInput;
    try {
      input = normalizePlatformAuditExportInput(form);
    } catch (error) {
      return error instanceof PlatformAuditContractError
        ? response(400)
        : response(503);
    }

    let dependencies: PlatformAuditExportRouteDependencies;
    try {
      dependencies = await loadDependencies();
    } catch {
      return response(503);
    }
    if (!isPlatformP7AAuditEnabled(dependencies.env)) return response(503);

    let actor: ExportActorResult;
    try {
      actor = await dependencies.loadActor();
    } catch {
      return response(503);
    }
    if (actor.status !== "authenticated" || actor.actor.platformRole !== "admin") {
      return response(403);
    }

    let result: PlatformAuditExportResult;
    try {
      result = await dependencies.exportAudit(input);
    } catch (error) {
      if (error instanceof PlatformAuditRepositoryError) {
        if (error.kind === "unauthorized") {
          return response(403);
        }
        if (error.kind === "invalid" || error.kind === "too_large") return response(400);
      }
      return response(503);
    }

    const csv = serializePlatformAuditCsv(result.rows);
    return new Response(csv, {
      status: 200,
      headers: {
        ...RESPONSE_HEADERS,
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": 'attachment; filename="evo-platform-audit.csv"',
      },
    });
  };
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = createPlatformAuditExportHandler();
export const GET = methodNotAllowed;
export const HEAD = methodNotAllowed;
export const OPTIONS = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
