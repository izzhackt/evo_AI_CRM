import "server-only";

import { getPostgresClient } from "@/lib/server/database";

import type { PipelineLead, PipelineStage } from "@/components/v3/Pipeline";

/**
 * Единственное место, где воронка продаж знает, откуда берутся лиды.
 *
 * Порядок колонок — рабочий, а не алфавитный: как лид идёт по стадиям.
 * `disqualified` стоит последней, потому что это выход из воронки, а не
 * следующий шаг после `qualified`, хотя в контракте стадий он перечислен там.
 */
const STAGES: readonly PipelineStage[] = [
  { key: "new", title: "Новые", gate: false, terminal: false },
  { key: "qualifying", title: "Квалификация", gate: false, terminal: false },
  { key: "qualified", title: "Квалифицированы", gate: false, terminal: false },
  { key: "handoff_ready", title: "Готов к передаче", gate: true, terminal: false },
  { key: "handed_off", title: "Переданы", gate: false, terminal: true },
  { key: "disqualified", title: "Отказ", gate: false, terminal: true },
];

export function readPipelineStages(): readonly PipelineStage[] {
  return STAGES;
}

/**
 * Лиды одним запросом.
 *
 * Имя берётся из `evo_people.full_name` — у человека в этой схеме нет других
 * имён. Лид без связанного человека возможен по схеме (`person_id` обнуляем),
 * поэтому имя подставляется, а не падает.
 *
 * Срок считается и форматируется в самом запросе. Так «сегодня» и «02.09»
 * приходят из одного часового пояса — базы. Считать это в компоненте нельзя
 * (браузер жил бы в своём поясе), а считать в JS на сервере уже пробовал:
 * драйвер отдаёт `timestamptz` не как `Date`, и `Intl` падал на `Invalid time
 * value`. Аннотация типа у `sql<...>` — утверждение, а не проверка, и tsc это
 * пропустил.
 */
export async function readPipelineLeads(): Promise<readonly PipelineLead[]> {
  const sql = getPostgresClient();

  const rows = await sql<
    {
      id: string;
      name: string | null;
      stage: string;
      source: string | null;
      next_action: string | null;
      next_action_at: string | null;
      days: string | null;
    }[]
  >`
    select
      l.id,
      p.full_name                                                as name,
      l.stage,
      l.source,
      l.next_action,
      to_char(l.next_action_at, 'DD.MM')                          as next_action_at,
      (l.next_action_at::date - current_date)                     as days
    from evo_leads l
    left join evo_people p on p.id = l.person_id
    order by l.next_action_at asc nulls last, p.full_name asc
  `;

  return rows.map((row) => {
    const days = row.days === null ? null : Number(row.days);
    return {
      id: row.id,
      name: row.name ?? "Лид без имени",
      stageKey: row.stage,
      source: row.source ?? "источник неизвестен",
      nextAction: row.next_action,
      nextActionAt: row.next_action_at,
      due: days === null ? "none" : days < 0 ? "overdue" : days === 0 ? "today" : "later",
      href: `/v3/profile?lead=${row.id}`,
    } satisfies PipelineLead;
  });
}
