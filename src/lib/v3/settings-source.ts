import "server-only";

import { getPostgresClient } from "@/lib/server/database";
import {
  FIXED_ROLE_CAPABILITIES,
  FIXED_ROLE_ROUTES,
  fixedRoleCan,
  fixedRoleCanAccessRoute,
  fixedRoleHomeRoute,
  type FixedRole,
} from "@/lib/fixed-role-policy";

// Типы живут в компоненте, но `types.ts` реэкспортирует часть из этого файла —
// чтобы не заводить круговую зависимость, объявляем их здесь.
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

/**
 * Настройки, собранные из того, что действительно есть.
 *
 * Здесь намеренно нет ни одного переключателя. Настройки — самое лёгкое место,
 * чтобы нарисовать десяток тумблеров, которые никуда не ведут; такой экран
 * выглядит полным и не значит ничего.
 *
 * Матрица прав не выдумана и не продублирована: она вычисляется тем же
 * `fixedRoleCan`, которым закрыты настоящие маршруты. Если политика в коде
 * изменится, этот экран изменится вместе с ней — расходиться им нечем.
 */
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

/** Полный список страниц — чтобы в матрице были и запрещённые, не только свои. */
export function readRouteNames(): readonly string[] {
  return FIXED_ROLE_ROUTES;
}

/**
 * Состояние интеграций читается по факту работы, а не по галочке «включено»:
 * галочка может стоять у того, что ни разу ничего не сделало.
 */
export async function readIntegrations(): Promise<readonly Integration[]> {
  const sql = getPostgresClient();

  const [row] = await sql<
    { amo: string; sends: string; proposals: string; messages: string; contract: string; authority: string }[]
  >`
    select
      (select count(*) from evo_amocrm_accounts)          as amo,
      (select count(*) from evo_whatsapp_send_attempts)   as sends,
      (select count(*) from evo_ai_proposals)             as proposals,
      (select count(*) from evo_messages)                 as messages,
      (select max(version)::text from evo_database_contract) as contract,
      (select max(authority) from evo_database_contract)  as authority
  `;

  const n = (v: string) => Number(v ?? 0);

  return [
    {
      name: "WhatsApp · WAHA",
      state: n(row.sends) > 0 ? "работает" : "не отправляла",
      ok: n(row.sends) > 0,
      detail: `входящих сообщений: ${n(row.messages)}, попыток отправки: ${n(row.sends)}`,
    },
    {
      name: "amoCRM",
      state: n(row.amo) > 0 ? "подключена" : "не подключена",
      ok: n(row.amo) > 0,
      detail: `аккаунтов заведено: ${n(row.amo)}`,
    },
    {
      name: "Gemini · предложения",
      state: n(row.proposals) > 0 ? "работает" : "не использовалась",
      ok: n(row.proposals) > 0,
      detail: `предложений создано: ${n(row.proposals)}`,
    },
  ];
}

/**
 * Про саму платформу, а не про интеграции.
 *
 * Раньше база данных стояла в одном списке с amoCRM и WAHA, и её состояние
 * читалось как «ещё одна интеграция, и она работает». База — это не то, что
 * подключают; это то, на чём всё стоит.
 */
export async function readPlatformFact(): Promise<string> {
  const sql = getPostgresClient();
  const [row] = await sql<{ contract: string | null; authority: string | null }[]>`
    select max(version)::text as contract, max(authority) as authority
    from evo_database_contract
  `;
  return `${row?.authority ?? "неизвестно"} · версия контракта данных ${row?.contract ?? "—"}`;
}

/* ------------------------------------------------------ состояние системы */

export type Health = Readonly<{
  name: string;
  state: string;
  detail: string;
  tone: "ok" | "warn" | "off";
  /** Что нужно сделать и где, если работает не так. null — всё в порядке. */
  blocker: string | null;
  where: string | null;
}>;

/**
 * Состояние компонентов по факту, а не по галочке.
 *
 * Ни один из этих флагов нельзя переключить отсюда: они живут в файлах
 * окружения на сервере с правами 0600, и документация прямо запрещает менять
 * их из браузера (deploy/runtime-hardening.md). Поэтому вместо тумблера рядом
 * стоит то, что действительно поможет: где именно это меняется.
 */
export async function readHealth(): Promise<readonly Health[]> {
  const sql = getPostgresClient();
  const [row] = await sql<
    { messages: string; sends: string; amo: string; snaps: string; proposals: string; docs: string }[]
  >`
    select
      (select count(*) from evo_messages)                       as messages,
      (select count(*) from evo_whatsapp_send_attempts)         as sends,
      (select count(*) from evo_amocrm_accounts)                as amo,
      (select count(*) from evo_amocrm_discovery_snapshots)     as snaps,
      (select count(*) from evo_ai_proposals)                   as proposals,
      (select count(*) from evo_private_documents)              as docs
  `;
  const n = (v: string) => Number(v ?? 0);

  return [
    {
      name: "WhatsApp · WAHA",
      state: n(row.sends) > 0 ? "отправляла" : "нужна проверка",
      detail: `входящих ${n(row.messages)} · попыток отправки ${n(row.sends)}`,
      tone: n(row.sends) > 0 ? "ok" : "warn",
      // Это не «пока не сделали». Управление сессией намеренно вынесено за
      // пределы продукта: deploy/README.md:166 и EVO_LAUNCH_PLAN.md:470.
      blocker: "Номер подключается на сервере: QR и управление сессией намеренно вне продукта",
      where: "deploy/README.md:166 · docs/EVO_LAUNCH_PLAN.md:470",
    },
    {
      name: "Gemini · черновики ответов",
      state: n(row.proposals) > 0 ? "работает" : "выключен",
      detail: `предложений создано ${n(row.proposals)}`,
      tone: n(row.proposals) > 0 ? "ok" : "off",
      blocker: "Два флага в окружении сервера, файл под root, нужен перезапуск контейнера",
      where: "EVO_V2_GEMINI_PROPOSALS_ENABLED · EVO_V2_GEMINI_PROVIDER_AUTHORIZED",
    },
    {
      name: "amoCRM",
      state: n(row.amo) > 0 ? "подключён" : "не подключён",
      detail: `аккаунтов ${n(row.amo)} · сверок каталогов ${n(row.snaps)}`,
      tone: n(row.amo) > 0 ? "ok" : "off",
      blocker: "Токен кладётся файлом на диск сервера. OAuth и обновления токена нет",
      where: "src/lib/server/canonical-amocrm-token-store.ts",
    },
    {
      name: "База данных",
      state: "работает",
      detail: await readPlatformFact(),
      tone: "ok",
      blocker: null,
      where: null,
    },
    {
      name: "Хранилище документов",
      state: n(row.docs) > 0 ? "используется" : "не проверено",
      detail: `версий документов ${n(row.docs)} · PDF, JPEG, PNG до 25 MiB`,
      tone: n(row.docs) > 0 ? "ok" : "warn",
      blocker: "Каталог задаётся при развёртывании переменной EVO_PRIVATE_DOCUMENT_ROOT",
      where: "src/lib/server/private-document-files.ts",
    },
  ];
}

/* ------------------------------------------------------- журнал действий */

export type JournalEntry = Readonly<{
  id: string;
  transition: string;
  objectType: string;
  role: string;
  at: string;
  reason: string | null;
}>;

export type JournalFilters = Readonly<{ objectType?: string; role?: string }>;

/**
 * Журнал действий на шине бизнес-событий.
 *
 * ВАЖНО: журналов в системе два, и они в разных базах.
 *
 * 1. `evo_business_events` — здесь. Append-only, защищена триггером, 14 типов
 *    объектов. Это то, что показывает этот экран.
 * 2. Платформенный аудит в Supabase — 97 действий, 49 типов объектов,
 *    выгрузка в CSV. Бэкенд написан целиком (`searchPlatformAudit`,
 *    `/api/platform-audit/export`), но выключен флагом
 *    `EVO_PLATFORM_P7A_AUDIT_ENABLED` и ни одной страницей не вызывается.
 *
 * Актор в обеих — роль, а не человек: персональных учётных записей в системе
 * нет вовсе, поэтому вопрос «кто именно это сделал» неотвечаем в принципе.
 */
export async function readJournal(filters: JournalFilters = {}): Promise<readonly JournalEntry[]> {
  const sql = getPostgresClient();
  const objectType = filters.objectType ?? null;
  const role = filters.role ?? null;

  const rows = await sql<
    { id: string; transition: string; object_type: string; role: string; at: string; reason: string | null }[]
  >`
    select id, transition, business_object_type as object_type, actor_role as role,
           to_char(occurred_at, 'DD.MM HH24:MI') as at, reason
    from evo_business_events
    where (${objectType}::text is null or business_object_type = ${objectType})
      and (${role}::text is null or actor_role = ${role})
    order by occurred_at desc, event_sequence desc
    limit 60
  `;
  return rows.map((r) => ({
    id: r.id,
    transition: r.transition,
    objectType: r.object_type,
    role: r.role,
    at: r.at,
    reason: r.reason,
  }));
}

/** Какие типы объектов и роли реально встречаются — фильтры не выдумываются. */
export async function readJournalFacets(): Promise<
  Readonly<{ objectTypes: readonly Readonly<{ key: string; count: number }>[]; roles: readonly string[] }>
> {
  const sql = getPostgresClient();
  const types = await sql<{ key: string; n: string }[]>`
    select business_object_type as key, count(*)::text as n
    from evo_business_events group by 1 order by count(*) desc
  `;
  const roles = await sql<{ role: string }[]>`
    select distinct actor_role as role from evo_business_events order by 1
  `;
  return {
    objectTypes: types.map((t) => ({ key: t.key, count: Number(t.n) })),
    roles: roles.map((r) => r.role),
  };
}

/* ---------------------------------------------------- документы и гейты */

export type GateFacts = Readonly<{
  handoffs: number;
  overrides: number;
  financeStops: number;
  evidence: number;
  documents: number;
}>;

export async function readGateFacts(): Promise<GateFacts> {
  const sql = getPostgresClient();
  const [row] = await sql<
    { handoffs: string; overrides: string; stops: string; evidence: string; docs: string }[]
  >`
    select
      (select count(*) from evo_sales_admissions_handoffs)                      as handoffs,
      (select count(*) from evo_sales_admissions_handoffs where is_override)    as overrides,
      (select count(*) from evo_finance_stop_states where is_stopped)           as stops,
      (select count(*) from evo_sales_gate_evidence)                            as evidence,
      (select count(*) from evo_private_documents)                              as docs
  `;
  return {
    handoffs: Number(row.handoffs),
    overrides: Number(row.overrides),
    financeStops: Number(row.stops),
    evidence: Number(row.evidence),
    documents: Number(row.docs),
  };
}
