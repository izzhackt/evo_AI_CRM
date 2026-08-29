import { createHash, randomUUID } from "node:crypto";

import postgres from "postgres";

import {
  claimCanonicalAmoCrmCommandDispatch,
  prepareCanonicalAmoCrmCommand,
  settleCanonicalAmoCrmCommand,
} from "../src/lib/server/canonical-amocrm-command-repository.ts";
import { createCanonicalPersonLead } from "../src/lib/server/canonical-crm-repository.ts";
import { closeDatabaseConnections } from "../src/lib/server/database.ts";

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

const databaseUrl = required("DATABASE_URL");
const sql = postgres(databaseUrl, { idle_timeout: 5, max: 1, onnotice: () => undefined });

try {
  const technicalRunId = randomUUID();
  const lead = await createCanonicalPersonLead({
    actorRole: "admin",
    idempotencyKey: randomUUID(),
    correlationId: randomUUID(),
    displayName: `technical-amocrm-blocker-${technicalRunId}`,
    email: `amocrm-blocker-${technicalRunId}@technical.invalid`,
    source: "technical-amocrm-browser-proof",
  });
  const leadId = lead.leadId;

  const accountId = randomUUID();
  const bindingId = randomUUID();
  const providerAccountId = String(
    (BigInt(`0x${accountId.replaceAll("-", "").slice(0, 15)}`) % 900000000n) +
      100000000n,
  );
  const providerLeadId = "466900001";
  await sql`
    insert into evo_amocrm_accounts (
      id,
      provider_account_id,
      account_base_url,
      account_subdomain,
      account_name,
      timezone
    ) values (
      ${accountId},
      ${providerAccountId},
      'https://evo-v2-browser-proof.amocrm.ru',
      'evo-v2-browser-proof',
      'EVO V2 browser proof',
      'Asia/Dubai'
    )
  `;
  await sql`
    insert into evo_amocrm_lead_bindings (
      id,
      account_id,
      lead_id,
      provider_lead_id,
      last_verified_at
    ) values (
      ${bindingId},
      ${accountId},
      ${leadId},
      ${providerLeadId},
      now()
    )
  `;

  const correlationId = randomUUID();
  const idempotencyKey = `${correlationId}:lead_note_create`;
  const noteHash = sha256("isolated-browser-unknown-proof");
  const requestMetadata = Object.freeze({
    schemaVersion: 1,
    discoverySnapshotId: randomUUID(),
    request: Object.freeze({
      method: "POST",
      path: `/api/v4/leads/${providerLeadId}/notes`,
      requestId: idempotencyKey,
    }),
    bodySha256: sha256("isolated-browser-provider-body"),
    expected: Object.freeze({
      entity: "lead_note",
      leadId: providerLeadId,
      textSha256: noteHash,
    }),
  });
  const authorization = Object.freeze({
    actorRole: "sales",
    workflowScope: "sales_pre_handoff",
    workflowLeadId: leadId,
    studentCaseId: null,
  });
  const prepared = await prepareCanonicalAmoCrmCommand({
    accountId,
    operationName: "lead_note_create",
    personId: null,
    leadId,
    actorRole: "sales",
    authorization,
    targetContactId: null,
    targetLeadId: providerLeadId,
    providerRequestMetadata: requestMetadata,
    providerRequestSha256: sha256(JSON.stringify(requestMetadata)),
    correlationId,
    idempotencyKey,
  });
  await claimCanonicalAmoCrmCommandDispatch(
    prepared.attempt.attemptId,
    authorization,
  );
  const settled = await settleCanonicalAmoCrmCommand(
    prepared.attempt.attemptId,
    authorization,
    {
      status: "unknown",
      failureCode: "isolated_browser_outcome_unknown",
    },
  );
  process.stdout.write(`${settled.attempt.attemptId} ${leadId}\n`);
} finally {
  await closeDatabaseConnections();
  await sql.end({ timeout: 5 });
}
