import "server-only";

import { getPostgresClient } from "@/lib/server/database";

import type { PersonProfile, ProfilePick } from "@/components/v3/Profile";

/**
 * Профиль человека — один на всех, лид он или уже студент.
 *
 * В базе это два объекта: `evo_leads` (сторона продаж) и `evo_student_cases`
 * (сторона приёмной), связанные через `lead_id`. В интерфейсе это один
 * человек на разной стадии, а не две карточки: сначала он лид, потом тот же
 * человек — студент. Поэтому источник склеивает их здесь, а не заставляет
 * экран знать про две таблицы.
 *
 * Кейса может не быть — тогда возвращается профиль лида, и блоков про заявку
 * и визу просто нет. Это не пустое состояние, а нормальная стадия.
 */

/**
 * Кого можно открыть — для переключателя в прототипе.
 *
 * Список намеренно короткий: это леса, чтобы посмотреть обе стадии, а не
 * очередь людей. Девятнадцать кнопок забивали бы саму часть, ради которой
 * страницу открыли. По три с каждой стадии хватает.
 */
export async function readProfilePicks(): Promise<readonly ProfilePick[]> {
  const sql = getPostgresClient();
  const rows = await sql<{ id: string; name: string; has_case: boolean }[]>`
    select id, name, has_case from (
      select l.id, p.full_name as name, (sc.id is not null) as has_case,
             row_number() over (
               partition by (sc.id is not null)
               order by p.full_name asc
             ) as rank
      from evo_leads l
      join evo_people p on p.id = l.person_id
      left join evo_student_cases sc on sc.lead_id = l.id
    ) ranked
    where rank <= 3
    order by has_case desc, name asc
  `;
  return rows.map((r) => ({ id: r.id, name: r.name, student: r.has_case }));
}

export async function readProfile(leadId: string): Promise<PersonProfile | null> {
  const sql = getPostgresClient();

  const [head] = await sql<
    {
      lead_id: string;
      case_id: string | null;
      person: string | null;
      email: string | null;
      phone: string | null;
      stage: string;
      source: string;
      qualification: string | null;
      case_status: string | null;
      lead_action: string | null;
      lead_action_at: string | null;
      case_action: string | null;
      case_action_at: string | null;
      arrived: string | null;
    }[]
  >`
    select l.id as lead_id, sc.id as case_id,
           p.full_name as person, p.email, p.phone_e164 as phone,
           l.stage, l.source, l.qualification_summary as qualification,
           sc.status as case_status,
           l.next_action as lead_action,
           to_char(l.next_action_at, 'DD.MM') as lead_action_at,
           sc.next_action as case_action,
           to_char(sc.next_action_at, 'DD.MM') as case_action_at,
           to_char(l.created_at, 'DD.MM.YYYY') as arrived
    from evo_leads l
    join evo_people p on p.id = l.person_id
    left join evo_student_cases sc on sc.lead_id = l.id
    where l.id = ${leadId}
  `;
  if (!head) return null;

  const caseId = head.case_id;

  // Заявки, визу и историю имеет смысл спрашивать только когда кейс есть.
  const applications = caseId
    ? await sql<
        { id: string; institution_name: string; program_name: string; target_intake: string; status: string; next_action: string | null; next_action_at: string | null }[]
      >`
        select id, institution_name, program_name, target_intake, status, next_action,
               to_char(next_action_at, 'DD.MM') as next_action_at
        from evo_university_applications where student_case_id = ${caseId}
        order by created_at asc
      `
    : [];

  const visa = caseId
    ? await sql<{ id: string; milestone_kind: string; status: string; due: string | null; blocked_reason: string | null }[]>`
        select id, milestone_kind, status, to_char(due_at, 'DD.MM') as due, blocked_reason
        from evo_visa_milestones where student_case_id = ${caseId}
      `
    : [];

  const [stop] = caseId
    ? await sql<{ reason: string; asserted: boolean }[]>`
        select reason, is_stopped as asserted
        from evo_finance_stop_states where student_case_id = ${caseId}
      `
    : [];

  const [handoff] = caseId
    ? await sql<{ at: string; contract: boolean; payment: boolean; override: boolean }[]>`
        select to_char(executed_at, 'DD.MM.YYYY') as at,
               contract_evidence_id is not null as contract,
               first_payment_evidence_id is not null as payment,
               is_override as override
        from evo_sales_admissions_handoffs where student_case_id = ${caseId}
      `
    : [];

  // История — про человека целиком: и продажную часть, и учебную.
  const timeline = await sql<
    { id: string; transition: string; role: string; at: string }[]
  >`
    select id, transition, actor_role as role, to_char(occurred_at, 'DD.MM HH24:MI') as at
    from evo_business_events
    where business_object_id = ${leadId}
       or (${caseId}::text is not null and business_object_id = ${caseId})
       or business_object_id in (select id from evo_university_applications where student_case_id = ${caseId})
       or business_object_id in (select id from evo_visa_milestones where student_case_id = ${caseId})
       or business_object_id in (select id from evo_admissions_tasks where student_case_id = ${caseId})
       or business_object_id in (select id from evo_conversations where lead_id = ${leadId})
    order by occurred_at desc, event_sequence desc
    limit 40
  `;

  // Порядок вех — процессный, а не по времени создания: нумерация обещает
  // последовательность, и она обязана быть настоящей.
  const VISA_ORDER = ["document_preparation", "submission", "appointment", "biometrics", "interview", "decision"];
  visa.sort((a, b) => {
    const ia = VISA_ORDER.indexOf(a.milestone_kind);
    const ib = VISA_ORDER.indexOf(b.milestone_kind);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });

  return {
    leadId: head.lead_id,
    person: head.person ?? "Без имени",
    email: head.email,
    phone: head.phone,
    student: caseId !== null,
    stage: head.stage,
    caseStatus: head.case_status,
    /** Есть в модели, показывается только внутри блока «Продажа». */
    source: head.source,
    qualification: head.qualification,
    arrived: head.arrived,
    nextAction: head.case_action ?? head.lead_action,
    nextActionAt: head.case_action_at ?? head.lead_action_at,
    handoff: handoff
      ? { at: handoff.at, contract: handoff.contract, payment: handoff.payment, override: handoff.override }
      : null,
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
    timeline: timeline.map((t) => ({ id: t.id, transition: t.transition, role: t.role, at: t.at })),
  } satisfies PersonProfile;
}
