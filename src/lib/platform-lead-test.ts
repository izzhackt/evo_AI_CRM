/**
 * «Тестовый лид» (миграция 385): вкл/выкл пометки и чтение пометок. Тестовый лид не будит ИИ-агентов и не считается
 * в воронке и инструментах агента. Права, версии и состояния решает база (`set_lead_is_test_v1`: право на правку лида
 * и `lead.read` на этот лид); проверки прав вызывающих — только подсказка для экрана. Запись идемпотентна по request id.
 */
import type { PlatformActor } from "./platform-auth";

export type LeadTestStatus = "saved" | "unchanged" | "preview" | "forbidden" | "archived" | "request_conflict" | "invalid" | "unavailable";

export type LeadTestReceipt = Readonly<{ leadId: string; isTest: boolean; changed: boolean; requestId: string }>;

export class PlatformLeadTestError extends Error {
  readonly status: Exclude<LeadTestStatus, "saved" | "unchanged">;

  constructor(status: Exclude<LeadTestStatus, "saved" | "unchanged">) {
    super("Lead test flag command failed.");
    this.name = "PlatformLeadTestError";
    this.status = status;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function parseLeadTestUuid(value: unknown): string | null {
  return typeof value === "string" && UUID.test(value.toLowerCase()) ? value.toLowerCase() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Код ошибки RPC -> состояние для экрана. Неизвестное — «неизвестно, повторить тем же id». */
export function leadTestStatusFromRpcError(error: unknown): Exclude<LeadTestStatus, "saved" | "unchanged" | "preview"> {
  if (!isRecord(error)) return "unavailable";
  const code = typeof error.code === "string" ? error.code : null;
  const message = typeof error.message === "string" ? error.message.trim() : null;
  if (code === "42501") return "forbidden";
  if (code === "PT409") return "archived";
  if (code === "22023") return message === "lead_test_flag_request_conflict" ? "request_conflict" : "invalid";
  return "unavailable";
}

/** Квитанция — только то, что база записала; чужой лид, чужой request id и мусор — «неизвестно». */
export function normalizeLeadTestReceipt(
  value: unknown,
  expected: Readonly<{ organizationId: string; leadId: string; requestId: string; isTest: boolean }>,
): LeadTestReceipt {
  if (!isRecord(value) || value.organization_id !== expected.organizationId || value.lead_id !== expected.leadId
    || value.request_id !== expected.requestId || value.is_test !== expected.isTest || typeof value.changed !== "boolean") {
    throw new PlatformLeadTestError("unavailable");
  }
  return Object.freeze({ leadId: expected.leadId, isTest: expected.isTest, changed: value.changed, requestId: expected.requestId });
}

type RpcClient = Readonly<{
  schema(name: "platform"): { rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> };
}>;

async function platformClient(): Promise<RpcClient> {
  if (typeof window !== "undefined") throw new PlatformLeadTestError("unavailable");
  const { createSupabaseServerClient } = await import("./supabase/server");
  return (await createSupabaseServerClient()) as unknown as RpcClient;
}

function organizationOf(actor: PlatformActor): string {
  return parseLeadTestUuid(actor.organizationId) ?? (() => { throw new PlatformLeadTestError("invalid"); })();
}

/** Одна запись через `platform.set_lead_is_test_v1`. «unavailable» — исход неизвестен: повторите с ТЕМ ЖЕ request id. */
export async function setLeadIsTest(
  actor: PlatformActor,
  command: Readonly<{ leadId: string; isTest: boolean; requestId: string }>,
  deps: Readonly<{ client?: RpcClient }> = {},
): Promise<LeadTestReceipt> {
  const organizationId = organizationOf(actor);
  const leadId = parseLeadTestUuid(command.leadId);
  const requestId = parseLeadTestUuid(command.requestId);
  if (!leadId || !requestId || typeof command.isTest !== "boolean") throw new PlatformLeadTestError("invalid");
  let response;
  try {
    const client = deps.client ?? await platformClient();
    response = await client.schema("platform").rpc("set_lead_is_test_v1", {
      p_organization_id: organizationId, p_lead_id: leadId, p_is_test: command.isTest, p_request_id: requestId,
    });
  } catch {
    throw new PlatformLeadTestError("unavailable");
  }
  if (response.error) throw new PlatformLeadTestError(leadTestStatusFromRpcError(response.error));
  return normalizeLeadTestReceipt(response.data, { organizationId, leadId, requestId, isTest: command.isTest });
}

/**
 * Какие из лидов помечены «Тестовый лид» (`staff_lead_test_flags_v1`; только видимые по `lead.read`). Метка — подсказка
 * на экране: не прочиталась — null (экран не рисует метку и не падает), а не «никто не тестовый».
 */
export async function readTestLeadIds(
  actor: PlatformActor,
  leadIds: readonly string[],
  deps: Readonly<{ client?: RpcClient }> = {},
): Promise<ReadonlySet<string> | null> {
  if (leadIds.length === 0) return new Set();
  try {
    const organizationId = organizationOf(actor);
    const ids = leadIds.map((id) => parseLeadTestUuid(id));
    if (leadIds.length > 4000 || ids.some((id) => id === null)) return null;
    const client = deps.client ?? await platformClient();
    const { data, error } = await client.schema("platform").rpc("staff_lead_test_flags_v1", {
      p_organization_id: organizationId, p_lead_ids: ids,
    });
    if (error || !isRecord(data) || data.organization_id !== organizationId || !Array.isArray(data.test_lead_ids)) return null;
    const asked = new Set(ids as string[]);
    const found = new Set<string>();
    for (const id of data.test_lead_ids as unknown[]) {
      const parsed = parseLeadTestUuid(id);
      if (!parsed || !asked.has(parsed)) return null;
      found.add(parsed);
    }
    return found;
  } catch {
    return null;
  }
}
