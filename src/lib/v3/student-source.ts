import "server-only";

import { getPostgresClient } from "@/lib/server/database";

import type { StudentCase } from "@/components/v3/Student360";

/**
 * Досье студента: кейс, заявка в вуз, визовые вехи, финансовый стоп, история.
 *
 * Всё одним заходом на конкретный кейс. Ничего не выдумывается: чего в модели
 * нет — не приходит и не рисуется.
 *
 * Что показывает эта база сегодня и почему экран выглядит именно так: все
 * четыре кейса `active`, все заявки в статусе `draft`, все 24 визовые вехи
 * `pending`. Ни одна ступень ещё не сдвинулась. Экран, который выглядел бы
 * бодрее, врал бы.
 */
export async function readStudentCaseIds(): Promise<readonly string[]> {
  const sql = getPostgresClient();
  const rows = await sql<{ id: string }[]>`
    select sc.id from evo_student_cases sc
    left join evo_people p on p.id = sc.person_id
    order by p.full_name asc
  `;
  return rows.map((r) => r.id);
}

export async function readStudentCase(caseId: string): Promise<StudentCase | null> {
  const sql = getPostgresClient();

  const [head] = await sql<
    {
      id: string;
      person: string | null;
      email: string | null;
      phone: string | null;
      status: string;
      owner_role: string;
      next_action: string | null;
      next_action_at: string | null;
      lead_id: string | null;
      source: string | null;
      stage: string | null;
    }[]
  >`
    select sc.id, p.full_name as person, p.email, p.phone_e164 as phone,
           sc.status, sc.owner_role, sc.next_action,
           to_char(sc.next_action_at, 'DD.MM') as next_action_at,
           sc.lead_id, l.source, l.stage
    from evo_student_cases sc
    left join evo_people p on p.id = sc.person_id
    left join evo_leads l on l.id = sc.lead_id
    where sc.id = ${caseId}
  `;
  if (!head) return null;

  const applications = await sql<
    { id: string; institution_name: string; program_name: string; target_intake: string; status: string; next_action: string | null; next_action_at: string | null }[]
  >`
    select id, institution_name, program_name, target_intake, status, next_action,
           to_char(next_action_at, 'DD.MM') as next_action_at
    from evo_university_applications where student_case_id = ${caseId}
    order by created_at asc
  `;

  // Порядок вех — процессный, а не по времени создания записи. Нумеровать
  // шаги, разложенные в случайном порядке, значит обещать последовательность,
  // которой в данных нет.
  const VISA_ORDER = [
    "document_preparation", "submission", "appointment",
    "biometrics", "interview", "decision",
  ];

  const visa = await sql<
    { id: string; milestone_kind: string; status: string; due: string | null; blocked_reason: string | null }[]
  >`
    select id, milestone_kind, status, to_char(due_at, 'DD.MM') as due, blocked_reason
    from evo_visa_milestones where student_case_id = ${caseId}
  `;
  visa.sort((a, b) => {
    const ia = VISA_ORDER.indexOf(a.milestone_kind);
    const ib = VISA_ORDER.indexOf(b.milestone_kind);
    // Неизвестный вид не теряется и не притворяется первым — уходит в конец.
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });

  const [stop] = await sql<{ reason: string; asserted: boolean }[]>`
    select reason, is_stopped as asserted
    from evo_finance_stop_states where student_case_id = ${caseId}
  `;

  const timeline = await sql<
    { id: string; transition: string; from_state: string | null; to_state: string | null; actor_role: string; at: string; object_type: string }[]
  >`
    select id, transition, from_state, to_state, actor_role,
           to_char(occurred_at, 'DD.MM HH24:MI') as at,
           business_object_type as object_type
    from evo_business_events
    where business_object_id = ${caseId}
       or business_object_id in (select id from evo_university_applications where student_case_id = ${caseId})
       or business_object_id in (select id from evo_visa_milestones where student_case_id = ${caseId})
       or business_object_id in (select id from evo_admissions_tasks where student_case_id = ${caseId})
    order by occurred_at desc, event_sequence desc
    limit 40
  `;

  return {
    id: head.id,
    person: head.person ?? "Без имени",
    email: head.email,
    phone: head.phone,
    status: head.status,
    ownerRole: head.owner_role,
    nextAction: head.next_action,
    nextActionAt: head.next_action_at,
    source: head.source,
    stage: head.stage,
    applications: applications.map((a) => ({
      id: a.id,
      institution: a.institution_name,
      program: a.program_name,
      intake: a.target_intake,
      status: a.status,
      nextAction: a.next_action,
      nextActionAt: a.next_action_at,
    })),
    visa: visa.map((v) => ({
      id: v.id,
      kind: v.milestone_kind,
      status: v.status,
      due: v.due,
      blockedReason: v.blocked_reason,
    })),
    financeStop: stop?.asserted ? stop.reason : null,
    timeline: timeline.map((t) => ({
      id: t.id,
      transition: t.transition,
      from: t.from_state,
      to: t.to_state,
      role: t.actor_role,
      at: t.at,
      objectType: t.object_type,
    })),
  } satisfies StudentCase;
}
