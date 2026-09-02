import postgres from "postgres";

function ensure(condition, message) {
  if (!condition) throw new Error(message);
}

export async function readCanonicalAmoCrmMutationCounts(
  connectionString,
  leadId,
) {
  const sql = postgres(connectionString, { max: 1, onnotice: () => undefined });
  try {
    const [row] = await sql`
      select
        (select count(*)::integer
          from evo_amocrm_operation_attempts) as amocrm_attempt_count,
        (select count(distinct attempt.command_receipt_id)::integer
          from evo_amocrm_operation_attempts attempt) as amocrm_receipt_count,
        (select count(*)::integer
          from evo_amocrm_contact_bindings
          where person_id = (select person_id from evo_leads where id = ${leadId}))
          as contact_binding_count,
        (select count(*)::integer
          from evo_amocrm_lead_bindings
          where lead_id = ${leadId}) as lead_binding_count,
        (select count(*)::integer
          from evo_business_events) as business_event_count
    `;
    ensure(row, "PostgreSQL amoCRM mutation-count proof was unavailable");
    return Object.freeze({
      amocrmAttemptCount: Number(row.amocrm_attempt_count),
      amocrmReceiptCount: Number(row.amocrm_receipt_count),
      contactBindingCount: Number(row.contact_binding_count),
      leadBindingCount: Number(row.lead_binding_count),
      businessEventCount: Number(row.business_event_count),
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export function sameCanonicalAmoCrmMutationCounts(before, after) {
  return (
    before.amocrmAttemptCount === after.amocrmAttemptCount &&
    before.amocrmReceiptCount === after.amocrmReceiptCount &&
    before.contactBindingCount === after.contactBindingCount &&
    before.leadBindingCount === after.leadBindingCount &&
    before.businessEventCount === after.businessEventCount
  );
}
