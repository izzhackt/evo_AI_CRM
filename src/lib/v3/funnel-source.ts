import "server-only";

import { getPostgresClient } from "@/lib/server/database";

import type { FunnelStage } from "@/components/v3/Funnel";
import type { Metric } from "@/components/v3/MetricCard";

/**
 * Единственное место, где воронка знает, откуда берутся числа.
 *
 * Компонент принимает только `FunnelStage[]`. Когда платформа переедет на
 * Supabase, меняется эта функция, а не фигура и не страница.
 *
 * Ступени намеренно считаются одним запросом: пять отдельных обращений дали бы
 * пять снимков в разные моменты, и воронка могла бы показать рост там, где его
 * не было.
 */
export async function readAdmissionsFunnel(): Promise<readonly FunnelStage[]> {
  const sql = getPostgresClient();

  const [row] = await sql<
    {
      leads: string;
      qualified: string;
      handed_off: string;
      cases: string;
      applications: string;
    }[]
  >`
    select
      (select count(*) from evo_leads)                                        as leads,
      (select count(*) from evo_leads
        where stage in ('qualified', 'handoff_ready', 'handed_off'))          as qualified,
      (select count(*) from evo_leads where stage = 'handed_off')             as handed_off,
      (select count(*) from evo_student_cases)                                as cases,
      (select count(*) from evo_university_applications)                      as applications
  `;

  return [
    { name: "Лиды", value: Number(row.leads) },
    { name: "Квалифицированы", value: Number(row.qualified) },
    { name: "Переданы", value: Number(row.handed_off) },
    { name: "Student case", value: Number(row.cases) },
    { name: "Заявки в вузы", value: Number(row.applications) },
  ];
}

/**
 * Метрики верхнего ряда.
 *
 * Изменения за месяц здесь нет ни у одной карточки, и это не упущение: все
 * записи созданы одним днём, сравнивать не с чем. Карточка получает `delta:
 * null` и говорит причину вместо выдуманного процента. Когда история появится,
 * меняется эта функция, а не карточка.
 */
export async function readDashboardMetrics(): Promise<readonly Metric[]> {
  const sql = getPostgresClient();

  const [row] = await sql<
    { leads: string; people: string; active: string; handed: string }[]
  >`
    select
      (select count(*) from evo_leads)                                    as leads,
      (select count(*) from evo_people)                                   as people,
      (select count(*) from evo_leads
        where stage not in ('handed_off', 'disqualified'))                as active,
      (select count(*) from evo_leads where stage = 'handed_off')         as handed
  `;

  const leads = Number(row.leads);
  const handed = Number(row.handed);
  const share = leads > 0 ? Math.round((handed / leads) * 100) : 0;

  return [
    { label: "Всего лидов", value: leads, delta: null, insteadOfDelta: "нет истории за месяц" },
    { label: "Людей в базе", value: Number(row.people), delta: null, insteadOfDelta: "нет истории за месяц" },
    { label: "В работе", value: Number(row.active), delta: null, insteadOfDelta: "не переданы, не отказ" },
    { label: "Передано в Admissions", value: handed, delta: { direction: "up", text: `${share}% от всех лидов` }, insteadOfDelta: null },
  ];
}
