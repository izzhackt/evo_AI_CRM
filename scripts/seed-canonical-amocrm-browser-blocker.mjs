import { createHash, randomUUID } from "node:crypto";

import postgres from "postgres";

import {
  claimCanonicalAmoCrmCommandDispatch,
  prepareCanonicalAmoCrmCommand,
  settleCanonicalAmoCrmCommand,
} from "../src/lib/server/canonical-amocrm-command-repository.ts";
import {
  createCanonicalPersonLead,
  handoffCanonicalLeadToAdmissions,
  updateCanonicalSalesLeadWorkflow,
} from "../src/lib/server/canonical-crm-repository.ts";
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
const sql = postgres(databaseUrl, {
  idle_timeout: 5,
  max: 1,
  onnotice: () => undefined,
});

async function createTechnicalLead(label) {
  const technicalRunId = randomUUID();
  return createCanonicalPersonLead({
    actorRole: "admin",
    idempotencyKey: randomUUID(),
    correlationId: randomUUID(),
    displayName: `technical-amocrm-${label}-${technicalRunId}`,
    email: `amocrm-${label}-${technicalRunId}@technical.invalid`,
    source: `technical-amocrm-browser-${label}-proof`,
  });
}

async function bindTechnicalLead({ accountId, leadId, providerLeadId }) {
  await sql`
    insert into evo_amocrm_lead_bindings (
      id,
      account_id,
      lead_id,
      provider_lead_id,
      last_verified_at
    ) values (
      ${randomUUID()},
      ${accountId},
      ${leadId},
      ${providerLeadId},
      now()
    )
  `;
}

async function createTechnicalUnknownAttempt({
  accountId,
  leadId,
  providerLeadId,
  proofLabel,
}) {
  const correlationId = randomUUID();
  const idempotencyKey = `${correlationId}:lead_note_create`;
  const noteHash = sha256(`isolated-browser-${proofLabel}-unknown-proof`);
  const requestMetadata = Object.freeze({
    schemaVersion: 1,
    discoverySnapshotId: randomUUID(),
    request: Object.freeze({
      method: "POST",
      path: `/api/v4/leads/${providerLeadId}/notes`,
      requestId: idempotencyKey,
    }),
    bodySha256: sha256(`isolated-browser-${proofLabel}-provider-body`),
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
      failureCode: `isolated_browser_${proofLabel}_outcome_unknown`,
    },
  );
  return settled.attempt.attemptId;
}

try {
  const accountId = randomUUID();
  const providerAccountId = String(
    (BigInt(`0x${accountId.replaceAll("-", "").slice(0, 15)}`) % 900000000n) +
      100000000n,
  );
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

  const salesLead = await createTechnicalLead("sales-active");
  await bindTechnicalLead({
    accountId,
    leadId: salesLead.leadId,
    providerLeadId: "466900001",
  });
  const salesAttemptId = await createTechnicalUnknownAttempt({
    accountId,
    leadId: salesLead.leadId,
    providerLeadId: "466900001",
    proofLabel: "sales_active",
  });

  const admissionsLead = await createTechnicalLead("admissions-carry");
  const qualifiedAdmissionsLead = await updateCanonicalSalesLeadWorkflow(
    {
      actorRole: "admin",
      idempotencyKey: randomUUID(),
      correlationId: randomUUID(),
    },
    {
      leadId: admissionsLead.leadId,
      expectedVersion: admissionsLead.version,
      stage: "qualified",
      qualificationSummary:
        "Technical browser proof for a prior Sales ambiguity carried into Admissions",
      nextAction: "Exercise the isolated Admin override handoff",
      nextActionAt: new Date(Date.now() + 86_400_000)
        .toISOString()
        .slice(0, 10),
    },
  );
  await bindTechnicalLead({
    accountId,
    leadId: qualifiedAdmissionsLead.leadId,
    providerLeadId: "466900002",
  });
  const admissionsAttemptId = await createTechnicalUnknownAttempt({
    accountId,
    leadId: qualifiedAdmissionsLead.leadId,
    providerLeadId: "466900002",
    proofLabel: "admissions_carry",
  });
  const handoff = await handoffCanonicalLeadToAdmissions({
    actorRole: "admin",
    idempotencyKey: randomUUID(),
    correlationId: randomUUID(),
    leadId: qualifiedAdmissionsLead.leadId,
    expectedVersion: qualifiedAdmissionsLead.version,
    adminOverride: {
      reason:
        "Technical browser proof: carry prior Sales ambiguity into active Admissions",
    },
  });
  if (!handoff.isOverride) {
    throw new Error(
      "technical admissions carry proof did not create an Admin override",
    );
  }

  process.stdout.write(
    [
      salesAttemptId,
      salesLead.leadId,
      admissionsAttemptId,
      qualifiedAdmissionsLead.leadId,
      handoff.studentCaseId,
    ].join(" ") + "\n",
  );
} finally {
  await closeDatabaseConnections();
  await sql.end({ timeout: 5 });
}
