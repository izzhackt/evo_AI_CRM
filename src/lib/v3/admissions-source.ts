import "server-only";
import type { ActivePlatformActor } from "../platform-auth";
import {
  ADMISSIONS_APPLICATION_FIELDS, ADMISSIONS_CASE_FIELDS, ADMISSIONS_DIRECTIONS, ADMISSIONS_STAGES, ADMISSIONS_VISA_FIELDS,
  validateAdmissionsFields, type AdmissionsPlaybook, type AdmissionsSummary, type AdmissionsWorkspace, type AdmissionsMutationReceipt,
} from "../platform-admissions-playbook-contract.ts";

export class AdmissionsSourceError extends Error {
  readonly code: "invalid" | "stale" | "denied" | "request_conflict" | "unavailable";
  constructor(code: AdmissionsSourceError["code"] = "unavailable") { super("Admissions data unavailable"); this.code = code; }
}
function invalid(): never { throw new AdmissionsSourceError(); }
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : invalid();
}
function list(value: unknown, max = 500): unknown[] { return Array.isArray(value) && value.length <= max ? value : invalid(); }
function text(value: unknown, max = 2000): string { return typeof value === "string" && value.length > 0 && value.length <= max ? value : invalid(); }
function nullableText(value: unknown, max = 2000): string | null { return value === null ? null : text(value, max); }
function uuid(value: unknown): string { return typeof value === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value) ? value : invalid(); }
function nullableUuid(value: unknown): string | null { return value === null ? null : uuid(value); }
function version(value: unknown): string { return typeof value === "string" && /^(0|[1-9]\d{0,18})$/.test(value) && BigInt(value) <= BigInt("9223372036854775807") ? value : invalid(); }
function date(value: unknown): string { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value ? value : invalid(); }
function nullableDate(value: unknown): string | null { return value === null ? null : date(value); }
function timestamp(value: unknown): string { return typeof value === "string" && /T/.test(value) && Number.isFinite(Date.parse(value)) ? value : invalid(); }
function choice<T extends string>(value: unknown, values: readonly T[]): T { return typeof value === "string" && values.includes(value as T) ? value as T : invalid(); }
function count(value: unknown): number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : invalid(); }
function texts(value: unknown, max = 100): string[] { return list(value, max).map((item) => text(item, 8000)); }
const OUTCOMES = ["active", "arrived", "cancelled"] as const;

export function normalizeAdmissionsPlaybook(input: unknown): AdmissionsPlaybook {
  const row = record(input), content = record(row.content);
  const stages = list(content.stages, 7).map((value) => {
    const item = record(value);
    return { key: choice(item.key, ADMISSIONS_STAGES), title: text(item.title, 200), summary: text(item.summary), checklist: texts(item.checklist), exitCriteria: texts(item.exitCriteria), cautions: texts(item.cautions) };
  });
  if (stages.length !== 7 || stages.some((stage, index) => stage.key !== ADMISSIONS_STAGES[index])) return invalid();
  return {
    id: uuid(row.id), direction: choice(row.direction, ["CN", "MY"]), version: text(row.version, 40), title: text(row.title, 200), publishedAt: timestamp(row.publishedAt),
    content: {
      stages,
      tasks: list(content.tasks, 100).map((value) => {
        const item = record(value);
        if (item.studentVisible !== false) return invalid();
        return { key: text(item.key, 150), stageKey: choice(item.stageKey, ADMISSIONS_STAGES), title: text(item.title, 300), priority: choice(item.priority, ["normal", "high"]), studentVisible: false };
      }),
      messages: list(content.messages, 100).map((value) => {
        const item = record(value);
        return { id: text(item.id, 100), stageKey: choice(item.stageKey, ADMISSIONS_STAGES), title: text(item.title, 250), audience: choice(item.audience, ["student", "referral", "partner", "university"]), locale: choice(item.locale, ["ru", "en"]), whenToUse: text(item.whenToUse), body: text(item.body, 12000), sourceIds: texts(item.sourceIds), placeholders: list(item.placeholders, 40).map((raw) => { const field = record(raw); return { key: text(field.key, 100), label: text(field.label, 200) }; }) };
      }),
      sources: list(content.sources, 100).map((value) => {
        const item = record(value);
        const url = item.url === undefined ? undefined : text(item.url, 2048);
        if (url && !/^https:\/\//.test(url)) return invalid();
        return { id: text(item.id, 100), title: text(item.title, 400), kind: text(item.kind, 80), sourceVersion: text(item.sourceVersion, 200), ...(item.sha256 === undefined ? {} : { sha256: text(item.sha256, 64) }), ...(url ? { url } : {}), reviewedOn: date(item.reviewedOn), scope: text(item.scope, 8000) };
      }),
      limitations: texts(content.limitations),
    },
  };
}

export function normalizeAdmissionsWorkspace(input: unknown, organizationId: string, caseId: string): AdmissionsWorkspace {
  const row = record(input), item = record(row.case);
  if (item.id !== caseId || item.organizationId !== organizationId) return invalid();
  const playbook = row.playbook === null ? null : normalizeAdmissionsPlaybook(row.playbook);
  const details = validateAdmissionsFields(item.facts, ADMISSIONS_CASE_FIELDS);
  const workspace: AdmissionsWorkspace = {
    case: { id: uuid(item.id), organizationId: uuid(item.organizationId), direction: item.direction === null ? null : choice(item.direction, ADMISSIONS_DIRECTIONS),
      playbookVersionId: nullableUuid(item.playbookVersionId), version: version(item.version), stage: text(item.stage, 100), outcome: item.outcome === null ? null : choice(item.outcome, OUTCOMES),
      state: choice(item.state, ["pending", "active", "closed"]), primaryApplicationId: nullableUuid(item.primaryApplicationId), routeApprovalStatus: choice(item.routeApprovalStatus, ["draft", "approved", "rework"]),
      nextAction: nullableText(item.nextAction, 1000), nextActionDueOn: nullableDate(item.nextActionDueOn), facts: details },
    playbook,
    applications: list(row.applications).map((value) => { const app = record(value); return { id: uuid(app.id), institutionName: text(app.institutionName, 300), programName: text(app.programName, 300), status: text(app.status, 80), version: version(app.version), details: validateAdmissionsFields(app.details, ADMISSIONS_APPLICATION_FIELDS) }; }),
    visa: row.visa === null ? null : (() => { const visa = record(row.visa); return { id: uuid(visa.id), status: text(visa.status, 80), version: version(visa.version), details: validateAdmissionsFields(visa.details, ADMISSIONS_VISA_FIELDS) }; })(),
    // Handoff has its own existing, explicitly scoped projection in Profile.
    handoff: null,
    gates: list(row.gates, 7).map((value) => { const gate = record(value); if (typeof gate.ready !== "boolean") return invalid(); return { stage: choice(gate.stage, ADMISSIONS_STAGES), ready: gate.ready, blockers: texts(gate.blockers) }; }),
    events: list(row.events, 100).map((value) => { const event = record(value); return { id: uuid(event.id), kind: text(event.kind, 100), stage: text(event.stage, 100), outcome: event.outcome === null ? null : choice(event.outcome, OUTCOMES), reason: text(event.reason), createdAt: timestamp(event.createdAt), effectiveOn: nullableDate(event.effectiveOn) }; }),
  };
  if ((playbook?.id ?? null) !== workspace.case.playbookVersionId || (playbook && playbook.direction !== workspace.case.direction)) return invalid();
  if (workspace.case.primaryApplicationId && !workspace.applications.some((app) => app.id === workspace.case.primaryApplicationId)) return invalid();
  return workspace;
}

export function normalizeAdmissionsSummary(input: unknown): AdmissionsSummary {
  const row = record(input);
  const stock = list(row.stock, 6).map((value) => {
    const item = record(value);
    return { direction: choice(item.direction, [...ADMISSIONS_DIRECTIONS, "unknown"]), active: count(item.active), overdue: count(item.overdue), awaiting_ack: count(item.awaiting_ack), awaiting_partner: count(item.awaiting_partner), submitted: count(item.submitted), decisions: count(item.decisions), visas: count(item.visas), arrivals: count(item.arrivals), arrived: count(item.arrived), cancelled: count(item.cancelled) };
  });
  if (new Set(stock.map((item) => item.direction)).size !== stock.length) return invalid();
  return { periodFrom: nullableDate(row.periodFrom), periodTo: nullableDate(row.periodTo), stock, periodArrivals: list(row.periodArrivals, 6).map((value) => { const item = record(value); return { direction: choice(item.direction, [...ADMISSIONS_DIRECTIONS, "unknown"]), count: count(item.count) }; }) };
}

export function normalizeAdmissionsReceipt(input: unknown, expected: { caseId?: string; applicationId?: string; visaCaseId?: string; requestId: string }): AdmissionsMutationReceipt {
  const row = record(input);
  for (const [key, value] of Object.entries(expected)) if (value !== undefined && row[key] !== value) return invalid();
  return { caseId: uuid(row.caseId), version: version(row.version), requestId: uuid(row.requestId), changedAt: timestamp(row.changedAt),
    ...(row.stage === undefined ? {} : { stage: text(row.stage, 100) }), ...(row.outcome == null ? {} : { outcome: choice(row.outcome, OUTCOMES) }),
    ...(row.applicationId === undefined ? {} : { applicationId: uuid(row.applicationId) }), ...(row.visaCaseId === undefined ? {} : { visaCaseId: uuid(row.visaCaseId) }) };
}

export async function admissionsRpc(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const { createSupabaseServerClient } = await import("../supabase/server");
  const client = await createSupabaseServerClient();
  const { data, error } = await client.schema("platform").rpc(name, args);
  if (error) throw new AdmissionsSourceError(error.code === "42501" ? "denied" : error.code === "40001" || error.code === "PT409" ? "stale" : error.code === "23505" ? "request_conflict" : error.code === "22023" ? "invalid" : "unavailable");
  return data;
}
function staff(actor: ActivePlatformActor): void {
  if (actor.authorityRole === "sales" || actor.presentationRole === "sales") throw new AdmissionsSourceError("denied");
}
export async function readAdmissionsPlaybooks(actor: ActivePlatformActor): Promise<AdmissionsPlaybook[]> {
  staff(actor); return list(record(await admissionsRpc("admissions_playbook_catalog_v1")).playbooks, 30).map(normalizeAdmissionsPlaybook);
}
export async function readAdmissionsWorkspace(actor: ActivePlatformActor, caseId: string): Promise<AdmissionsWorkspace> {
  staff(actor); return normalizeAdmissionsWorkspace(await admissionsRpc("staff_case_admissions_workspace_v1", { p_student_case_id: uuid(caseId) }), actor.organizationId, caseId);
}
export async function readAdmissionsSummary(actor: ActivePlatformActor, params: { direction?: string; curatorMembershipId?: string; periodFrom?: string; periodTo?: string }): Promise<AdmissionsSummary> {
  staff(actor);
  return normalizeAdmissionsSummary(await admissionsRpc("admissions_direction_summary_v1", { p_direction: params.direction ?? null, p_curator_membership_id: params.curatorMembershipId ?? null, p_period_from: params.periodFrom ?? null, p_period_to: params.periodTo ?? null }));
}
