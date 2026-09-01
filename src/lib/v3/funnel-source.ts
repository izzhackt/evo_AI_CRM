import "server-only";

import { getPostgresClient } from "@/lib/server/database";

import type { FunnelStage } from "@/components/v3/Funnel";

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
