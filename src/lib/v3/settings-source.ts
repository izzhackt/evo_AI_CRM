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

import type { Integration, RoleRow } from "@/components/v3/Settings";

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
    {
      name: "База данных",
      state: row.authority ?? "неизвестно",
      ok: true,
      detail: `версия контракта данных: ${row.contract ?? "—"}`,
    },
  ];
}
