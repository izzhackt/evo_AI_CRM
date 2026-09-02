import "server-only";

import { getPostgresClient } from "@/lib/server/database";

import type { QueueTask } from "@/components/v3/TaskQueue";

/**
 * Очередь задач приёмной кампании.
 *
 * Одним запросом: срок, состояние срока и имя студента считаются в базе — у
 * неё единственный часовой пояс, а у браузера свой. Формат «DD.MM» тоже
 * собирается там же; JS-`Intl` на этих полях уже падал (драйвер отдаёт
 * `timestamptz` не как `Date`).
 */
export async function readTaskQueue(): Promise<readonly QueueTask[]> {
  const sql = getPostgresClient();

  const rows = await sql<
    {
      id: string;
      title: string;
      details: string | null;
      status: string;
      assigned_role: string;
      person: string | null;
      due: string | null;
      days: string | null;
      closure_reason: string | null;
    }[]
  >`
    select
      t.id,
      t.title,
      t.details,
      t.status,
      t.assigned_role,
      p.full_name                              as person,
      to_char(t.due_at, 'DD.MM')               as due,
      (t.due_at::date - current_date)          as days,
      t.closure_reason
    from evo_admissions_tasks t
    left join evo_student_cases sc on sc.id = t.student_case_id
    left join evo_people p on p.id = sc.person_id
    order by t.due_at asc nulls last, t.title asc
  `;

  return rows.map((row) => {
    const days = row.days === null ? null : Number(row.days);
    return {
      id: row.id,
      title: row.title,
      details: row.details,
      open: row.status === "open",
      status: row.status,
      role: row.assigned_role,
      person: row.person,
      due: row.due,
      when: days === null ? "none" : days < 0 ? "overdue" : days === 0 ? "today" : days === 1 ? "tomorrow" : "later",
      closureReason: row.closure_reason,
    } satisfies QueueTask;
  });
}
