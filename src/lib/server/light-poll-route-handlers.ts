import "server-only";

import { isPortalPollSection, type PortalPollSection } from "../portal-poll-section.ts";
import { readReleaseMetadata } from "../release-metadata.ts";

/**
 * Два лёгких GET-маршрута опроса (A4, docs/PLAN_CHANGES.md 19.10.2026):
 *  - `/api/portal/updates?s=<раздел>` — кабинет студента;
 *  - `/api/v3/notifications/state` — колокольчик CRM.
 * Каждый делает ровно один RPC. Proxy пропускает их в режиме «только
 * обновить сессию» (без RPC доступа), а роль и права проверяет сам RPC:
 * студенческая функция отвечает `access: false` не-студенту, функция
 * сотрудников — студенту. Ответ несёт только число, хэш версии данных и
 * ревизию сервера (для распознавания устаревшей сборки); ни имён, ни
 * текстов, ни сумм.
 */
const HEADERS = Object.freeze({
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
});

const VERSION_PATTERN = /^[0-9a-f]{32}$/u;

export type LightPollOutcome =
  | Readonly<{ status: "ok"; unread: number; version: string | null }>
  | Readonly<{ status: "anonymous" | "denied" | "unavailable" }>;

type RpcResponse = Readonly<{
  data: unknown;
  error: Readonly<{ code?: string }> | null;
  status?: number;
}>;

function json(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: HEADERS });
}

/** Разбор ответа RPC: доступ, число и версия или честный отказ. */
export function decodeLightPollRpc(response: RpcResponse): LightPollOutcome {
  if (response.error) {
    const code = response.error.code;
    // Просроченный или недействительный JWT у PostgREST — 401/PGRST30x.
    if (response.status === 401 || code === "PGRST301" || code === "PGRST302") return { status: "anonymous" };
    if (response.status === 403 || code === "42501") return { status: "denied" };
    return { status: "unavailable" };
  }
  const data = response.data;
  if (typeof data !== "object" || data === null || Array.isArray(data)) return { status: "unavailable" };
  const { access, unread, version } = data as Record<string, unknown>;
  if (access === false) return { status: "denied" };
  if (access !== true) return { status: "unavailable" };
  const count = typeof unread === "string" && /^\d{1,15}$/u.test(unread) ? Number(unread) : unread;
  if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) return { status: "unavailable" };
  if (version !== null && (typeof version !== "string" || !VERSION_PATTERN.test(version))) return { status: "unavailable" };
  return { status: "ok", unread: count, version };
}

function reply(outcome: LightPollOutcome, release: string | null): Response {
  if (outcome.status === "ok") {
    return json(200, { release, unread: outcome.unread, version: outcome.version });
  }
  if (outcome.status === "anonymous") return json(401, { error: "authentication_required" });
  if (outcome.status === "denied") return json(403, { error: "forbidden" });
  return json(503, { error: "unavailable" });
}

function serverRelease(): string | null {
  const metadata = readReleaseMetadata();
  return metadata.status === "available" ? metadata.revision : null;
}

export type StudentPortalUpdatesDependencies = Readonly<{
  poll(section: PortalPollSection | null): Promise<LightPollOutcome>;
  release(): string | null;
}>;

type RpcClient = Readonly<{
  schema(name: "platform"): {
    rpc(name: string, args?: Record<string, unknown>, options?: { get?: boolean }): PromiseLike<unknown>;
  };
}>;

/** Один RPC студенческого опроса. GET: функция STABLE; пустой параметр не передаётся, иначе в query string он стал бы текстом «null». */
export async function requestStudentPortalPoll(client: RpcClient, section: PortalPollSection | null): Promise<LightPollOutcome> {
  const response = await client
    .schema("platform")
    .rpc("student_portal_poll_v1", section === null ? {} : { p_section: section }, { get: true });
  return decodeLightPollRpc(response as RpcResponse);
}

/** Один RPC колокольчика. POST: функция VOLATILE, при чтении она создаёт напоминания о сроках (миграция 188). */
export async function requestStaffNotificationsState(client: RpcClient): Promise<LightPollOutcome> {
  return decodeLightPollRpc((await client.schema("platform").rpc("staff_notifications_state_v1")) as RpcResponse);
}

const studentDependencies: StudentPortalUpdatesDependencies = {
  async poll(section) {
    const { createSupabaseServerClient } = await import("../supabase/server.ts");
    return requestStudentPortalPoll((await createSupabaseServerClient()) as unknown as RpcClient, section);
  },
  release: serverRelease,
};

export function createStudentPortalUpdatesHandler(
  dependencies: StudentPortalUpdatesDependencies = studentDependencies,
) {
  return async function GET(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      const keys = [...url.searchParams.keys()];
      if (keys.some((key) => key !== "s") || keys.length > 1) return json(400, { error: "invalid_request" });
      const requested = url.searchParams.get("s");
      if (requested !== null && !isPortalPollSection(requested)) return json(400, { error: "invalid_request" });
      const outcome = await dependencies.poll(requested);
      return reply(outcome, dependencies.release());
    } catch {
      return json(503, { error: "unavailable" });
    }
  };
}

export type StaffNotificationsStateDependencies = Readonly<{
  poll(): Promise<LightPollOutcome>;
  release(): string | null;
}>;

const staffDependencies: StaffNotificationsStateDependencies = {
  async poll() {
    const { createSupabaseServerClient } = await import("../supabase/server.ts");
    return requestStaffNotificationsState((await createSupabaseServerClient()) as unknown as RpcClient);
  },
  release: serverRelease,
};

export function createStaffNotificationsStateHandler(
  dependencies: StaffNotificationsStateDependencies = staffDependencies,
) {
  return async function GET(request: Request): Promise<Response> {
    try {
      if ([...new URL(request.url).searchParams.keys()].length > 0) return json(400, { error: "invalid_request" });
      return reply(await dependencies.poll(), dependencies.release());
    } catch {
      return json(503, { error: "unavailable" });
    }
  };
}
