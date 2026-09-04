import "server-only";

import { cache } from "react";

import {
  FIXED_ROLE_CAPABILITIES,
  FIXED_ROLE_ROUTES,
  fixedRoleCan,
  fixedRoleCanAccessRoute,
  fixedRoleHomeRoute,
  type FixedRole,
} from "@/lib/fixed-role-policy";
import type { ActivePlatformActor } from "@/lib/platform-auth";
import {
  PLATFORM_AUDIT_RESOURCE_TYPES,
  type PlatformAuditSafeRow,
} from "@/lib/platform-audit";
import { isPlatformP7AAuditEnabled } from "@/lib/platform-audit-config";
import {
  PlatformAuditActionError,
  searchPlatformAudit,
} from "@/lib/platform-audit-actions";
import {
  getPlatformWahaSessionHealth,
  type PlatformWahaSessionHealth,
} from "@/lib/platform-communications";
import { providerDisplayStatus } from "@/lib/provider-display-status";
import { readCanonicalAmoCrmCommandAvailability } from "@/lib/server/canonical-amocrm-command-actions";
import { loadPlatformOperationsReadiness } from "@/lib/server/platform-operations-readiness";
import {
  platformWahaHealthDisplayStatus,
  readPlatformGeminiProviderAvailability,
} from "@/lib/server/platform-provider-readiness";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type RoleRow = Readonly<{
  role: string;
  home: string;
  capabilities: readonly Readonly<{ name: string; allowed: boolean }>[];
  routes: readonly string[];
}>;

export type Integration = Readonly<{
  name: string;
  state: string;
  ok: boolean;
  detail: string;
}>;

const ROLES: readonly FixedRole[] = ["admin", "sales", "admissions"];
const AUDIT_ACTOR_LABELS = ["Staff", "Service", "System"] as const;
const AUDIT_PAGE_SIZE = 100;

export function readAuditExportEnabled(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return isPlatformP7AAuditEnabled(environment);
}

function assertAdminAuthority(actor: ActivePlatformActor): void {
  if (actor.authorityRole !== "admin") {
    throw new Error("V3 settings are unavailable.");
  }
}

export function readRoles(): readonly RoleRow[] {
  return ROLES.map((role) => ({
    role,
    home: fixedRoleHomeRoute(role),
    capabilities: FIXED_ROLE_CAPABILITIES.map((capability) => ({
      name: capability,
      allowed: fixedRoleCan(role, capability),
    })),
    routes: FIXED_ROLE_ROUTES.filter((route) => fixedRoleCanAccessRoute(role, route)),
  }));
}

export function readCapabilityNames(): readonly string[] {
  return FIXED_ROLE_CAPABILITIES;
}

export function readRouteNames(): readonly string[] {
  return FIXED_ROLE_ROUTES;
}

type ProviderFacts = Readonly<{
  waha: PlatformWahaSessionHealth | null;
  wahaDisplay: ReturnType<typeof platformWahaHealthDisplayStatus>;
  geminiDisplay: ReturnType<typeof providerDisplayStatus>;
  amo: Awaited<ReturnType<typeof readCanonicalAmoCrmCommandAvailability>>;
}>;

const readProviderFacts = cache(
  async (actor: ActivePlatformActor): Promise<ProviderFacts> => {
    const [waha, amo] = await Promise.all([
      getPlatformWahaSessionHealth(actor, "crm_primary"),
      readCanonicalAmoCrmCommandAvailability(),
    ]);
    return {
      waha,
      wahaDisplay: platformWahaHealthDisplayStatus(waha),
      geminiDisplay: providerDisplayStatus(
        readPlatformGeminiProviderAvailability(),
      ),
      amo,
    };
  },
);

function wahaState(facts: ProviderFacts): Integration {
  const observed = facts.waha?.observedAt ?? "нет наблюдения";
  if (facts.wahaDisplay === "ready") {
    return {
      name: "WhatsApp",
      state: "готова",
      ok: true,
      detail: `crm_primary · WORKING · наблюдение ${observed}`,
    };
  }
  if (facts.wahaDisplay === "blocked") {
    return {
      name: "WhatsApp",
      state: "заблокирована",
      ok: false,
      detail: `crm_primary · ${facts.waha?.status ?? "нет статуса"} · наблюдение ${observed}`,
    };
  }
  return {
    name: "WhatsApp",
    state: "не подтверждена",
    ok: false,
    detail: "для crm_primary нет сохранённого подтверждения состояния",
  };
}

function geminiState(facts: ProviderFacts): Integration {
  if (facts.geminiDisplay === "configured_not_verified") {
    return {
      name: "Gemini · предложения",
      state: "настроен, не проверен",
      ok: false,
      detail: "ключ настроен; этот экран не выполняет provider call",
    };
  }
  return {
    name: "Gemini · предложения",
    state: facts.geminiDisplay === "blocked" ? "заблокирован" : "не настроен",
    ok: false,
    detail: "provider readiness закрыт конфигурацией",
  };
}

function amoState(facts: ProviderFacts): Integration {
  if (facts.amo.status === "ready") {
    return {
      name: "amoCRM",
      state: "настроена, не проверена",
      ok: false,
      detail: "маршруты и token file готовы; этот экран не пишет в amoCRM",
    };
  }
  return {
    name: "amoCRM",
    state: "заблокирована",
    ok: false,
    detail: `command readiness: ${facts.amo.reason}`,
  };
}

export async function readIntegrations(
  actor: ActivePlatformActor,
): Promise<readonly Integration[]> {
  assertAdminAuthority(actor);
  const facts = await readProviderFacts(actor);
  return [wahaState(facts), amoState(facts), geminiState(facts)];
}

const readOperationsReadiness = cache(loadPlatformOperationsReadiness);

export async function readPlatformFact(): Promise<string> {
  const readiness = await readOperationsReadiness();
  const supabase = readiness.components.supabase;
  const age = supabase.age_seconds === null ? "возраст неизвестен" : `${supabase.age_seconds} с`;
  return `Supabase · ${supabase.status} · ${age} · наблюдение ${readiness.observed_at}`;
}

export type Health = Readonly<{
  name: string;
  state: string;
  detail: string;
  tone: "ok" | "warn" | "off";
  blocker: string | null;
  where: string | null;
}>;

export async function readHealth(
  actor: ActivePlatformActor,
): Promise<readonly Health[]> {
  assertAdminAuthority(actor);
  const [facts, readiness] = await Promise.all([
    readProviderFacts(actor),
    readOperationsReadiness(),
  ]);
  const whatsapp = wahaState(facts);
  const gemini = geminiState(facts);
  const amo = amoState(facts);
  const supabase = readiness.components.supabase;

  return [
    {
      name: "WhatsApp",
      state: whatsapp.state,
      detail: whatsapp.detail,
      tone: whatsapp.ok ? "ok" : "warn",
      blocker: whatsapp.ok ? null : "Нет свежего сохранённого WORKING для crm_primary",
      where: whatsapp.ok ? null : "platform.staff_waha_session_health",
    },
    {
      name: "Gemini · черновики ответов",
      state: gemini.state,
      detail: gemini.detail,
      tone: gemini.ok ? "ok" : facts.geminiDisplay === "not_configured" ? "off" : "warn",
      blocker: gemini.ok ? null : "Конфигурация не является реальной provider-проверкой",
      where: gemini.ok ? null : "EVO_PLATFORM_GEMINI_API_KEY",
    },
    {
      name: "amoCRM",
      state: amo.state,
      detail: amo.detail,
      tone: amo.ok ? "ok" : "warn",
      blocker: amo.ok ? null : "Нет подтверждённой готовности command path",
      where: amo.ok ? null : "canonical amoCRM command readiness",
    },
    {
      name: "Supabase",
      state: supabase.status,
      detail: `наблюдение ${readiness.observed_at}`,
      tone: supabase.status === "ready" ? "ok" : "warn",
      blocker: supabase.status === "ready" ? null : "Нет свежего operational readiness",
      where: supabase.status === "ready" ? null : "EVO_PLATFORM_P7B_OBSERVABILITY_ENABLED",
    },
  ];
}

export type JournalEntry = Readonly<{
  id: string;
  transition: string;
  objectType: string;
  role: string;
  at: string;
  reason: string | null;
}>;

export type JournalFilters = Readonly<{ objectType?: string; role?: string }>;

function isAuditResourceType(
  value: string | undefined,
): value is (typeof PLATFORM_AUDIT_RESOURCE_TYPES)[number] {
  return value !== undefined && (PLATFORM_AUDIT_RESOURCE_TYPES as readonly string[]).includes(value);
}

function isAuditActorLabel(
  value: string | undefined,
): value is (typeof AUDIT_ACTOR_LABELS)[number] {
  return value !== undefined && (AUDIT_ACTOR_LABELS as readonly string[]).includes(value);
}

async function loadAuditRows(
  actor: ActivePlatformActor,
  objectType: string | undefined,
  pageSize: number,
): Promise<Readonly<{ rows: readonly PlatformAuditSafeRow[]; hasMore: boolean }>> {
  assertAdminAuthority(actor);
  if (objectType !== undefined && !isAuditResourceType(objectType)) {
    return { rows: [], hasMore: false };
  }

  try {
    const result = await searchPlatformAudit({
      page_size: String(pageSize),
      ...(objectType ? { resource_types: objectType } : {}),
    });
    return { rows: result.rows, hasMore: result.hasMore };
  } catch (error) {
    // The canonical audit is feature-gated. Disabled/unavailable yields no
    // projection here; it never falls back to a legacy journal.
    if (
      error instanceof PlatformAuditActionError &&
      error.kind === "unavailable"
    ) {
      return { rows: [], hasMore: false };
    }
    throw error;
  }
}

function formatAuditTime(value: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.valueOf())) {
    throw new Error("V3 settings are unavailable.");
  }
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Asia/Bishkek",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(parsed).replace(",", "");
}

export async function readJournal(
  actor: ActivePlatformActor,
  filters: JournalFilters = {},
): Promise<readonly JournalEntry[]> {
  if (filters.role !== undefined && !isAuditActorLabel(filters.role)) return [];
  const result = await loadAuditRows(actor, filters.objectType, 60);
  return result.rows
    .filter((row) => filters.role === undefined || row.actorDisplayLabel === filters.role)
    .map((row) => ({
      id: row.auditEventId,
      transition: row.action,
      objectType: row.resourceType,
      role: row.actorDisplayLabel,
      at: formatAuditTime(row.createdAt),
      reason: row.reasonCode,
    }));
}

export async function readJournalFacets(
  actor: ActivePlatformActor,
): Promise<Readonly<{
  objectTypes: readonly Readonly<{ key: string; count: number }>[];
  roles: readonly string[];
}>> {
  const result = await loadAuditRows(actor, undefined, AUDIT_PAGE_SIZE);
  // Counts over a truncated page would look exact. Omit the facets instead.
  if (result.hasMore) return { objectTypes: [], roles: [] };

  const counts = new Map<string, number>();
  const roles = new Set<string>();
  for (const row of result.rows) {
    counts.set(row.resourceType, (counts.get(row.resourceType) ?? 0) + 1);
    roles.add(row.actorDisplayLabel);
  }
  return {
    objectTypes: [...counts.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .map(([key, count]) => ({ key, count })),
    roles: [...roles].sort(),
  };
}

export type GateFacts = Readonly<{
  handoffs: number;
  overrides: number;
  financeStops: number;
  evidence: number;
  documents: number;
}>;

type ExactCountResult = Readonly<{
  count: number | null;
  error: unknown;
}>;

function exactCount(result: ExactCountResult): number {
  if (result.error !== null || result.count === null) {
    throw new Error("V3 settings are unavailable.");
  }
  return result.count;
}

export async function readGateFacts(
  actor: ActivePlatformActor,
): Promise<GateFacts> {
  assertAdminAuthority(actor);
  const client = await createSupabaseServerClient();
  const platform = client.schema("platform");
  const organizationId = actor.organizationId;

  const [handoffs, overrides, contractEvidence, paymentEvidence, stops, documents] =
    await Promise.all([
      platform
        .from("sales_admissions_handoffs")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId),
      platform
        .from("sales_admissions_handoffs")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .eq("handoff_mode", "exceptional_override"),
      platform
        .from("lead_admissions_gates")
        .select("lead_id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .eq("contract_confirmed", true),
      platform
        .from("lead_admissions_gates")
        .select("lead_id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .not("first_payment_confirmed_at", "is", null),
      platform
        .from("stop_factors")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .eq("status", "active"),
      platform
        .from("document_versions")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId),
    ]);

  return {
    handoffs: exactCount(handoffs),
    overrides: exactCount(overrides),
    financeStops: exactCount(stops),
    evidence: exactCount(contractEvidence) + exactCount(paymentEvidence),
    documents: exactCount(documents),
  };
}
