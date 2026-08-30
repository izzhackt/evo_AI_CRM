import postgres from "postgres";

function ensure(condition, message) {
  if (!condition) throw new Error(message);
}

export async function readV2_10dMutationCounts(
  connectionString,
  leadId,
  conversationId,
) {
  const sql = postgres(connectionString, { max: 1, onnotice: () => undefined });
  try {
    const [row] = await sql`
      select
        (select count(*)::integer
          from evo_ai_proposals
          where conversation_id = ${conversationId}) as proposal_count,
        (select count(*)::integer
          from evo_whatsapp_send_attempts
          where conversation_id = ${conversationId}) as waha_attempt_count,
        (select count(*)::integer
          from evo_messages
          where conversation_id = ${conversationId}
            and direction = 'outbound') as outbound_message_count,
        (select count(*)::integer
          from evo_messages
          where conversation_id = ${conversationId}) as message_count,
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
    ensure(row, "PostgreSQL mutation-count proof was unavailable");
    return Object.freeze({
      proposalCount: Number(row.proposal_count),
      wahaAttemptCount: Number(row.waha_attempt_count),
      outboundMessageCount: Number(row.outbound_message_count),
      messageCount: Number(row.message_count),
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

export function sameV2_10dMutationCounts(before, after) {
  return (
    before.proposalCount === after.proposalCount &&
    before.wahaAttemptCount === after.wahaAttemptCount &&
    before.outboundMessageCount === after.outboundMessageCount &&
    before.messageCount === after.messageCount &&
    before.amocrmAttemptCount === after.amocrmAttemptCount &&
    before.amocrmReceiptCount === after.amocrmReceiptCount &&
    before.contactBindingCount === after.contactBindingCount &&
    before.leadBindingCount === after.leadBindingCount &&
    before.businessEventCount === after.businessEventCount
  );
}
