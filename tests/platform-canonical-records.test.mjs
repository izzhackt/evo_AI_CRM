import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  PlatformCanonicalRecordsRepositoryError,
  getPlatformCanonicalClient,
  getPlatformCanonicalLead,
  listPlatformCanonicalClients,
  listPlatformCanonicalLeads,
  normalizePlatformCanonicalClientDetail,
  normalizePlatformCanonicalClientSummary,
  normalizePlatformCanonicalLeadDetail,
  normalizePlatformCanonicalLeadSummary,
  parsePlatformCanonicalCursor,
} from "../src/lib/platform-canonical-records.ts";

const LEAD_ID = "A120B6DB-2E3E-4A84-8873-073F4D2D33C3";
const ORGANIZATION_ID = "fc0a2c8d-91bb-4323-9dd2-f4057067012d";
const CLIENT_ID = "7be22cc5-0316-4bbc-9d91-e3d1d5775ddb";
const OWNER_MEMBERSHIP_ID = "75418598-7b40-4b62-ac03-bf72fdd14e21";
const EXTERNAL_IDENTIFIER_ID = "61318db8-645a-4c0d-9cf6-09ca68efda50";
const PROVENANCE_ID = "2240b9e7-9387-44f9-b120-08743098226e";
const STUDENT_CASE_ID = "eec32b28-a106-4421-8802-7a50bcb416ef";
const CONVERSATION_ID = "2f16eaa3-9fa7-487f-91b2-9ab9b504366f";
const SECOND_LEAD_ID = "dca013ca-52bb-42dd-8044-4fbb171c6c28";

function platformActor(platformRole = "sales", overrides = {}) {
  return {
    authUserId: "84660516-5a65-40b8-b5b1-4230cf9c31da",
    profileId: "e4a65b55-b781-4fe9-90ce-c62bd1ff67dd",
    membershipId: OWNER_MEMBERSHIP_ID,
    organizationId: ORGANIZATION_ID,
    displayName: "Platform operator",
    platformRole,
    platformAccessVersion: 12,
    platformBundleId: "00000000-0000-4000-8000-000000000802",
    platformBundleVersion: 12,
    role: platformRole === "student" ? "client" : platformRole,
    ...overrides,
  };
}

function getRpcClient(responses = {}, errors = {}) {
  const calls = [];
  return {
    calls,
    client: {
      schema(schemaName) {
        assert.equal(schemaName, "platform");
        return {
          async rpc(functionName, args, options) {
            calls.push({ functionName, args, options });
            return {
              data: responses[functionName] ?? null,
              error: errors[functionName] ?? null,
            };
          },
        };
      },
    },
  };
}

function validLeadRow(overrides = {}) {
  return {
    sort_at: "2026-08-24T10:20:30.123456+06:00",
    organization_id: ORGANIZATION_ID,
    lead_id: LEAD_ID,
    client_id: CLIENT_ID,
    client_display_name: "Айжан Токтосунова",
    client_email: "aizhan@example.com",
    client_phone: "+996 555 123 456",
    current_owner_membership_id: OWNER_MEMBERSHIP_ID,
    current_owner_display_name: "Sales operator",
    stage_key: "new_enquiry",
    source_key: "website",
    lifecycle_state: "open",
    open_duplicate_candidate_count: 2,
    linked_student_case_count: 1,
    linked_conversation_count: 3,
    created_at: "2026-08-20T08:00:00Z",
    updated_at: "2026-08-24T10:20:30.123456+06:00",
    ...overrides,
  };
}

function validClientRow(overrides = {}) {
  return {
    sort_at: "2026-08-24T11:20:30.123456+06:00",
    organization_id: ORGANIZATION_ID,
    client_id: CLIENT_ID,
    display_name: "Айжан Токтосунова",
    email: "aizhan@example.com",
    phone: "+996 555 123 456",
    lifecycle_state: "active",
    open_duplicate_candidate_count: 1,
    linked_lead_count: 2,
    linked_student_case_count: 1,
    linked_conversation_count: 3,
    created_at: "2026-08-20T08:00:00Z",
    updated_at: "2026-08-24T11:20:30.123456+06:00",
    ...overrides,
  };
}

function withoutSortAt(row) {
  const detail = { ...row };
  delete detail.sort_at;
  return detail;
}

function detailReferences() {
  return {
    external_identifiers: [
      {
        id: EXTERNAL_IDENTIFIER_ID,
        source_system: "amocrm",
        external_object_type: "contact",
        external_identifier: "9223372036854775807",
        observed_at: "2026-08-23T09:00:00Z",
        imported_at: null,
        source_ref: "amocrm:contact:9223372036854775807",
      },
    ],
    provenance: [
      {
        id: PROVENANCE_ID,
        source_system: "website",
        evidence_type: "form_submission",
        observed_at: "2026-08-22T08:00:00Z",
        imported_at: null,
        source_ref: "web-form:request-42",
        recorded_at: "2026-08-22T08:00:01Z",
      },
    ],
    linked_student_cases: [
      {
        student_case_id: STUDENT_CASE_ID,
        student_display_name: "Айжан Токтосунова",
        operational_stage: "documents",
        state: "active",
        updated_at: "2026-08-24T09:30:00Z",
      },
    ],
    linked_conversations: [
      {
        conversation_id: CONVERSATION_ID,
        subject: "Admissions enquiry",
        queue: "sales",
        status: "open",
        updated_at: "2026-08-24T09:45:00Z",
      },
    ],
  };
}

function linkedLead() {
  return {
    lead_id: LEAD_ID,
    stage_key: "new_enquiry",
    lifecycle_state: "open",
    source_key: "website",
    current_owner_membership_id: OWNER_MEMBERSHIP_ID,
    current_owner_display_name: "Sales operator",
    updated_at: "2026-08-24T10:20:30.123456+06:00",
  };
}

test("canonical cursors require a complete valid updated-at and UUID pair", () => {
  assert.deepEqual(
    parsePlatformCanonicalCursor("2026-08-24T10:20:30.123456+06:00", LEAD_ID),
    {
      updatedAt: "2026-08-24T10:20:30.123456+06:00",
      id: LEAD_ID.toLowerCase(),
    },
  );

  for (const [updatedAt, id] of [
    [null, LEAD_ID],
    ["2026-08-24T10:20:30Z", null],
    ["not-a-timestamp", LEAD_ID],
    ["2026-08-24T10:20:30Z", "00000000-0000-0000-0000-000000000000"],
  ]) {
    assert.throws(
      () => parsePlatformCanonicalCursor(updatedAt, id),
      PlatformCanonicalRecordsRepositoryError,
    );
  }

  assert.equal(parsePlatformCanonicalCursor(null, null), null);
});

test("normalizes a canonical lead without promoting linked-provider context", () => {
  assert.deepEqual(normalizePlatformCanonicalLeadSummary(validLeadRow()), {
    organizationId: ORGANIZATION_ID,
    id: LEAD_ID.toLowerCase(),
    clientId: CLIENT_ID,
    clientDisplayName: "Айжан Токтосунова",
    clientEmail: "aizhan@example.com",
    clientPhone: "+996 555 123 456",
    currentOwnerMembershipId: OWNER_MEMBERSHIP_ID,
    currentOwnerDisplayName: "Sales operator",
    stageKey: "new_enquiry",
    sourceKey: "website",
    lifecycleState: "open",
    openDuplicateCandidateCount: 2,
    hasOpenDuplicateCandidates: true,
    linkedStudentCaseCount: 1,
    linkedConversationCount: 3,
    createdAt: "2026-08-20T08:00:00Z",
    updatedAt: "2026-08-24T10:20:30.123456+06:00",
  });

  for (const invalid of [
    validLeadRow({ lifecycle_state: "active" }),
    validLeadRow({ stage_key: "Sales Pipeline" }),
    validLeadRow({ client_id: null }),
    validLeadRow({ current_owner_display_name: null }),
    validLeadRow({ open_duplicate_candidate_count: -1 }),
    validLeadRow({ updated_at: "2026-08-19T00:00:00Z" }),
  ]) {
    assert.throws(
      () => normalizePlatformCanonicalLeadSummary(invalid),
      PlatformCanonicalRecordsRepositoryError,
    );
  }
});

test("normalizes a canonical client with bounded linked-record counts", () => {
  assert.deepEqual(normalizePlatformCanonicalClientSummary(validClientRow()), {
    organizationId: ORGANIZATION_ID,
    id: CLIENT_ID,
    displayName: "Айжан Токтосунова",
    email: "aizhan@example.com",
    phone: "+996 555 123 456",
    lifecycleState: "active",
    openDuplicateCandidateCount: 1,
    hasOpenDuplicateCandidates: true,
    linkedLeadCount: 2,
    linkedStudentCaseCount: 1,
    linkedConversationCount: 3,
    createdAt: "2026-08-20T08:00:00Z",
    updatedAt: "2026-08-24T11:20:30.123456+06:00",
  });

  for (const invalid of [
    validClientRow({ display_name: "   " }),
    validClientRow({ lifecycle_state: "open" }),
    validClientRow({ email: "" }),
    validClientRow({ linked_lead_count: "2" }),
    validClientRow({ sort_at: "2026-08-24T11:20:31Z" }),
  ]) {
    assert.throws(
      () => normalizePlatformCanonicalClientSummary(invalid),
      PlatformCanonicalRecordsRepositoryError,
    );
  }
});

test("normalizes bounded canonical lead detail references", () => {
  const summary = withoutSortAt(validLeadRow());
  const detail = normalizePlatformCanonicalLeadDetail({
    ...summary,
    ...detailReferences(),
  });

  assert.equal(detail.id, LEAD_ID.toLowerCase());
  assert.deepEqual(detail.externalIdentifiers, [
    {
      id: EXTERNAL_IDENTIFIER_ID,
      sourceSystem: "amocrm",
      externalObjectType: "contact",
      externalIdentifier: "9223372036854775807",
      observedAt: "2026-08-23T09:00:00Z",
      importedAt: null,
      sourceRef: "amocrm:contact:9223372036854775807",
    },
  ]);
  assert.deepEqual(detail.provenance, [
    {
      id: PROVENANCE_ID,
      sourceSystem: "website",
      evidenceType: "form_submission",
      observedAt: "2026-08-22T08:00:00Z",
      importedAt: null,
      sourceRef: "web-form:request-42",
      recordedAt: "2026-08-22T08:00:01Z",
    },
  ]);
  assert.deepEqual(detail.linkedStudentCases, [
    {
      id: STUDENT_CASE_ID,
      studentDisplayName: "Айжан Токтосунова",
      operationalStage: "documents",
      state: "active",
      updatedAt: "2026-08-24T09:30:00Z",
    },
  ]);
  assert.deepEqual(detail.linkedConversations, [
    {
      id: CONVERSATION_ID,
      subject: "Admissions enquiry",
      queue: "sales",
      status: "open",
      updatedAt: "2026-08-24T09:45:00Z",
    },
  ]);

  assert.throws(
    () => normalizePlatformCanonicalLeadDetail({
      ...summary,
      ...detailReferences(),
      external_identifiers: new Array(26).fill(
        detailReferences().external_identifiers[0],
      ),
    }),
    PlatformCanonicalRecordsRepositoryError,
  );
});

test("normalizes bounded canonical client detail with authorized linked leads", () => {
  const summary = withoutSortAt(validClientRow());
  const references = detailReferences();
  const detail = normalizePlatformCanonicalClientDetail({
    ...summary,
    ...references,
    linked_leads: [linkedLead()],
  });

  assert.equal(detail.id, CLIENT_ID);
  assert.deepEqual(detail.linkedLeads, [
    {
      id: LEAD_ID.toLowerCase(),
      stageKey: "new_enquiry",
      lifecycleState: "open",
      sourceKey: "website",
      currentOwnerMembershipId: OWNER_MEMBERSHIP_ID,
      currentOwnerDisplayName: "Sales operator",
      updatedAt: "2026-08-24T10:20:30.123456+06:00",
    },
  ]);
  assert.equal(detail.externalIdentifiers.length, 1);
  assert.equal(detail.provenance.length, 1);
  assert.equal(detail.linkedStudentCases.length, 1);
  assert.equal(detail.linkedConversations.length, 1);

  assert.throws(
    () => normalizePlatformCanonicalClientDetail({
      ...summary,
      ...references,
      linked_leads: [linkedLead(), linkedLead()],
    }),
    PlatformCanonicalRecordsRepositoryError,
  );
});

test("canonical lead pages use the bounded GET RPC and return a stable next cursor", async () => {
  const repository = getRpcClient({
    staff_canonical_lead_page: [
      validLeadRow(),
      validLeadRow({
        lead_id: SECOND_LEAD_ID,
        sort_at: "2026-08-23T10:20:30Z",
        updated_at: "2026-08-23T10:20:30Z",
      }),
    ],
  });

  const page = await listPlatformCanonicalLeads(
    platformActor(),
    {
      pageSize: 1,
      stageKey: "new_enquiry",
      lifecycleState: "open",
      query: " Айжан ",
    },
    { client: repository.client },
  );

  assert.deepEqual(repository.calls, [
    {
      functionName: "staff_canonical_lead_page",
      args: {
        p_limit: 2,
        p_stage_key: "new_enquiry",
        p_lifecycle_state: "open",
        p_query: "Айжан",
      },
      options: { get: true },
    },
  ]);
  assert.equal(page.rows.length, 1);
  assert.equal(page.rows[0]?.id, LEAD_ID.toLowerCase());
  assert.deepEqual(page.nextCursor, {
    updatedAt: "2026-08-24T10:20:30.123456+06:00",
    id: LEAD_ID.toLowerCase(),
  });
  assert.equal(page.hasNext, true);
});

test("canonical client pages pass a complete keyset cursor to the bounded GET RPC", async () => {
  const repository = getRpcClient({
    staff_canonical_client_page: [validClientRow()],
  });
  const cursor = {
    updatedAt: "2026-08-25T12:00:00Z",
    id: "7dc3ed3e-5b87-4d5d-9f16-7828c0b01db5",
  };

  const page = await listPlatformCanonicalClients(
    platformActor("curator"),
    { cursor, lifecycleState: "active", query: "aizhan@example.com" },
    { client: repository.client },
  );

  assert.deepEqual(repository.calls, [
    {
      functionName: "staff_canonical_client_page",
      args: {
        p_limit: 51,
        p_before_sort_at: cursor.updatedAt,
        p_before_client_id: cursor.id,
        p_lifecycle_state: "active",
        p_query: "aizhan@example.com",
      },
      options: { get: true },
    },
  ]);
  assert.equal(page.rows[0]?.id, CLIENT_ID);
  assert.equal(page.nextCursor, null);
  assert.equal(page.hasNext, false);
});

test("canonical lead detail uses one bounded GET RPC and treats scoped absence as null", async () => {
  const summary = withoutSortAt(validLeadRow());
  const repository = getRpcClient({
    staff_canonical_lead_detail: [{ ...summary, ...detailReferences() }],
  });

  const detail = await getPlatformCanonicalLead(
    platformActor(),
    LEAD_ID,
    { client: repository.client },
  );
  assert.equal(detail?.id, LEAD_ID.toLowerCase());
  assert.deepEqual(repository.calls, [
    {
      functionName: "staff_canonical_lead_detail",
      args: { p_lead_id: LEAD_ID.toLowerCase() },
      options: { get: true },
    },
  ]);

  const absent = getRpcClient({ staff_canonical_lead_detail: [] });
  assert.equal(
    await getPlatformCanonicalLead(
      platformActor(),
      LEAD_ID,
      { client: absent.client },
    ),
    null,
  );
});

test("canonical client detail uses one bounded GET RPC", async () => {
  const summary = withoutSortAt(validClientRow());
  const repository = getRpcClient({
    staff_canonical_client_detail: [
      { ...summary, ...detailReferences(), linked_leads: [linkedLead()] },
    ],
  });

  const detail = await getPlatformCanonicalClient(
    platformActor("admin"),
    CLIENT_ID.toUpperCase(),
    { client: repository.client },
  );
  assert.equal(detail?.id, CLIENT_ID);
  assert.deepEqual(repository.calls, [
    {
      functionName: "staff_canonical_client_detail",
      args: { p_client_id: CLIENT_ID },
      options: { get: true },
    },
  ]);
});

test("canonical page inputs fail closed before any RPC for unsafe bounds or incomplete cursors", async () => {
  const invalidLeadOptions = [
    { pageSize: 0 },
    { pageSize: -1 },
    { pageSize: 51 },
    { pageSize: 1.5 },
    { pageSize: null },
    { cursor: {} },
    { cursor: { updatedAt: "2026-08-24T10:20:30Z" } },
    { cursor: { id: LEAD_ID } },
    { cursor: { updatedAt: null, id: null } },
    { cursor: { updatedAt: "invalid", id: LEAD_ID } },
    { stageKey: "Sales Pipeline" },
    { lifecycleState: "active" },
    { query: "   " },
  ];

  for (const options of invalidLeadOptions) {
    const repository = getRpcClient();
    await assert.rejects(
      listPlatformCanonicalLeads(
        platformActor(),
        options,
        { client: repository.client },
      ),
      PlatformCanonicalRecordsRepositoryError,
    );
    assert.deepEqual(repository.calls, []);
  }

  const repository = getRpcClient();
  await assert.rejects(
    listPlatformCanonicalClients(
      platformActor(),
      { lifecycleState: "open" },
      { client: repository.client },
    ),
    PlatformCanonicalRecordsRepositoryError,
  );
  assert.deepEqual(repository.calls, []);
});

test("canonical repositories accept only the three staff roles", async () => {
  for (const platformRole of ["finance", "student", "owner", null]) {
    const repository = getRpcClient();
    await assert.rejects(
      listPlatformCanonicalClients(
        platformActor(platformRole),
        undefined,
        { client: repository.client },
      ),
      PlatformCanonicalRecordsRepositoryError,
    );
    assert.deepEqual(repository.calls, []);
  }

  const malformedOrganization = getRpcClient();
  await assert.rejects(
    listPlatformCanonicalLeads(
      platformActor("admin", { organizationId: "not-a-uuid" }),
      undefined,
      { client: malformedOrganization.client },
    ),
    PlatformCanonicalRecordsRepositoryError,
  );
  assert.deepEqual(malformedOrganization.calls, []);
});

test("canonical repositories hide transport errors and reject malformed or cross-tenant responses", async () => {
  const transport = getRpcClient({}, {
    staff_canonical_lead_page: { code: "42501", message: "private database detail" },
  });
  await assert.rejects(
    listPlatformCanonicalLeads(
      platformActor(),
      undefined,
      { client: transport.client },
    ),
    (error) => {
      assert.equal(error.name, "PlatformCanonicalRecordsRepositoryError");
      assert.equal(error.message, "Platform canonical records are unavailable.");
      assert.doesNotMatch(error.message, /42501|private database detail/);
      return true;
    },
  );

  for (const rows of [
    null,
    [validLeadRow(), validLeadRow()],
    [validLeadRow({ organization_id: "13edc0b2-18d8-4cd2-829a-8740b3cfba3a" })],
    [
      validLeadRow({
        sort_at: "2026-08-23T00:00:00Z",
        updated_at: "2026-08-23T00:00:00Z",
      }),
      validLeadRow({
        lead_id: SECOND_LEAD_ID,
        sort_at: "2026-08-24T00:00:00Z",
        updated_at: "2026-08-24T00:00:00Z",
      }),
    ],
  ]) {
    const repository = getRpcClient({ staff_canonical_lead_page: rows });
    await assert.rejects(
      listPlatformCanonicalLeads(
        platformActor(),
        { pageSize: 1 },
        { client: repository.client },
      ),
      PlatformCanonicalRecordsRepositoryError,
    );
  }

  const leadDetail = withoutSortAt(validLeadRow());
  const tooManyDetails = getRpcClient({
    staff_canonical_lead_detail: [
      { ...leadDetail, ...detailReferences() },
      { ...leadDetail, ...detailReferences() },
    ],
  });
  await assert.rejects(
    getPlatformCanonicalLead(
      platformActor(),
      LEAD_ID,
      { client: tooManyDetails.client },
    ),
    PlatformCanonicalRecordsRepositoryError,
  );
});

test("canonical page ordering preserves PostgreSQL microsecond precision", async () => {
  const repository = getRpcClient({
    staff_canonical_lead_page: [
      validLeadRow({
        sort_at: "2026-08-24T10:20:30.123456+06:00",
        updated_at: "2026-08-24T10:20:30.123456+06:00",
      }),
      validLeadRow({
        lead_id: SECOND_LEAD_ID,
        sort_at: "2026-08-24T10:20:30.123455+06:00",
        updated_at: "2026-08-24T10:20:30.123455+06:00",
      }),
    ],
  });

  const page = await listPlatformCanonicalLeads(
    platformActor(),
    { pageSize: 2 },
    { client: repository.client },
  );
  assert.deepEqual(page.rows.map((row) => row.id), [
    LEAD_ID.toLowerCase(),
    SECOND_LEAD_ID,
  ]);
});

test("canonical runtime has only bounded Platform RPC reads and no legacy fallback", () => {
  const source = readFileSync(
    new URL("../src/lib/platform-canonical-records.ts", import.meta.url),
    "utf8",
  );
  for (const rpcName of [
    "staff_canonical_lead_page",
    "staff_canonical_lead_detail",
    "staff_canonical_client_page",
    "staff_canonical_client_detail",
  ]) {
    assert.match(source, new RegExp(`\\b${rpcName}\\b`));
  }
  assert.doesNotMatch(
    source,
    /(?:from\s+|import\(\s*)["']@?\/?(?:src\/)?lib\/(?:actions|db|queries)["']/,
  );
  assert.doesNotMatch(source, /better-sqlite3|\.from\s*\(|service_role/i);
  assert.match(source, /PLATFORM_CANONICAL_MAX_PAGE_SIZE\s*=\s*50/);
  assert.match(source, /p_limit:\s*pageSize\s*\+\s*1/g);
});
