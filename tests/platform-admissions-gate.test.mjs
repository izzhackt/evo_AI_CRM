import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";

import {
  getPlatformAdmissionsGate,
  mutatePlatformAdmissionsGate,
  normalizePlatformAdmissionsGate,
  parsePlatformAdmissionsGateFormData,
  parsePlatformAdmissionsGateUuid,
  PlatformAdmissionsGateRepositoryError,
} from "../src/lib/platform-admissions-gate.ts";

function dataModule(source) {
  return `data:text/javascript,${encodeURIComponent(source)}`;
}

globalThis.__platformAdmissionsGateActionTest = {
  RepositoryError: PlatformAdmissionsGateRepositoryError,
  actor: null,
  mutation: null,
  revalidated: [],
  async requireActor() {
    return this.actor;
  },
  parse(form) {
    return parsePlatformAdmissionsGateFormData(form);
  },
  parseUuid(value) {
    return parsePlatformAdmissionsGateUuid(value);
  },
  async mutate(actorValue, input) {
    return this.mutation(actorValue, input);
  },
  revalidatePath(path) {
    this.revalidated.push(path);
  },
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.includes("/platform-admissions-gate-actions.ts")) {
      if (specifier === "next/cache") {
        return {
          shortCircuit: true,
          url: dataModule(
            "export const revalidatePath = (path) => globalThis.__platformAdmissionsGateActionTest.revalidatePath(path);",
          ),
        };
      }
      if (specifier === "./platform-guards") {
        return {
          shortCircuit: true,
          url: dataModule(
            "export const requirePlatformSalesActor = () => globalThis.__platformAdmissionsGateActionTest.requireActor();",
          ),
        };
      }
      if (specifier === "./platform-admissions-gate") {
        return {
          shortCircuit: true,
          url: dataModule(`
            export const mutatePlatformAdmissionsGate = (actor, input) => globalThis.__platformAdmissionsGateActionTest.mutate(actor, input);
            export const parsePlatformAdmissionsGateFormData = (form) => globalThis.__platformAdmissionsGateActionTest.parse(form);
            export const parsePlatformAdmissionsGateUuid = (value) => globalThis.__platformAdmissionsGateActionTest.parseUuid(value);
            export const PlatformAdmissionsGateRepositoryError = globalThis.__platformAdmissionsGateActionTest.RepositoryError;
          `),
        };
      }
    }
    return nextResolve(specifier, context);
  },
});

const { updatePlatformAdmissionsGateAction } = await import(
  "../src/lib/platform-admissions-gate-actions.ts?action-test"
);

const read = (relativePath) =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

const ORGANIZATION_ID = "fc0a2c8d-91bb-4323-9dd2-f4057067012d";
const OTHER_ORGANIZATION_ID = "25b091ea-939a-48f7-ae63-106fbec5007e";
const LEAD_ID = "a120b6db-2e3e-4a84-8873-073f4d2d33c3";
const MEMBERSHIP_ID = "75418598-7b40-4b62-ac03-bf72fdd14e21";
const REQUEST_ID = "feec5db8-645a-4c0d-9cf6-09ca68efda50";

function actor(overrides = {}) {
  return {
    authUserId: "84660516-5a65-40b8-b5b1-4230cf9c31da",
    profileId: "e4a65b55-b781-4fe9-90ce-c62bd1ff67dd",
    membershipId: MEMBERSHIP_ID,
    organizationId: ORGANIZATION_ID,
    displayName: "Platform operator",
    platformRole: "sales",
    platformAccessVersion: 13,
    platformBundleId: "00000000-0000-4000-8000-000000001202",
    platformBundleVersion: 13,
    role: "sales",
    ...overrides,
  };
}

function rpcClient(responses = {}, errors = {}) {
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

function gateForm(overrides = {}) {
  const values = {
    lead_id: LEAD_ID,
    expected_gate_version: "1",
    request_id: REQUEST_ID,
    action: "confirm_contract",
    amount: "1250.50",
    currency: "USD",
    due_date: "2026-08-28",
    received_date: "",
    evidence_reference: " Договор EVO-2026-014 ",
    reason: "",
    ...overrides,
  };
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  return form;
}

function gateRow(overrides = {}) {
  return {
    organization_id: ORGANIZATION_ID,
    lead_id: LEAD_ID,
    contract_confirmed: true,
    contract_confirmed_by_membership_id: MEMBERSHIP_ID,
    contract_confirmed_at: "2026-08-25T09:10:11.123456+06:00",
    contract_evidence_reference: "Договор EVO-2026-014",
    first_payment_amount: 1250.5,
    first_payment_currency: "USD",
    first_payment_due_date: "2026-08-28",
    first_payment_received_date: "2026-08-26",
    first_payment_confirmed_by_membership_id: MEMBERSHIP_ID,
    first_payment_confirmed_at: "2026-08-26T10:11:12.123456+06:00",
    first_payment_evidence_reference: "Квитанция PAY-019",
    override_reason: null,
    overridden_by_membership_id: null,
    overridden_at: null,
    gate_state: "satisfied",
    normal_handoff_allowed: true,
    exceptional_handoff_allowed: false,
    can_confirm_contract: false,
    can_confirm_first_payment: false,
    can_override_gate: false,
    gate_version: 3,
    updated_at: "2026-08-26T10:11:12.123456+06:00",
    ...overrides,
  };
}

function contractConfirmedRow(overrides = {}) {
  return gateRow({
    first_payment_received_date: null,
    first_payment_confirmed_by_membership_id: null,
    first_payment_confirmed_at: null,
    first_payment_evidence_reference: null,
    gate_state: "blocked",
    normal_handoff_allowed: false,
    can_confirm_first_payment: true,
    gate_version: 2,
    updated_at: "2026-08-25T09:10:11.123456+06:00",
    ...overrides,
  });
}

function overrideRow(overrides = {}) {
  return gateRow({
    contract_confirmed: false,
    contract_confirmed_by_membership_id: null,
    contract_confirmed_at: null,
    contract_evidence_reference: null,
    first_payment_amount: null,
    first_payment_currency: null,
    first_payment_due_date: null,
    first_payment_received_date: null,
    first_payment_confirmed_by_membership_id: null,
    first_payment_confirmed_at: null,
    first_payment_evidence_reference: null,
    override_reason: "Исключение одобрено директором",
    overridden_by_membership_id: MEMBERSHIP_ID,
    overridden_at: "2026-08-25T11:12:13.123456+06:00",
    gate_state: "overridden",
    normal_handoff_allowed: false,
    exceptional_handoff_allowed: true,
    gate_version: 2,
    updated_at: "2026-08-25T11:12:13.123456+06:00",
    ...overrides,
  });
}

test("U5 gate normalization accepts only coherent canonical facts", () => {
  const gate = normalizePlatformAdmissionsGate(gateRow());

  assert.equal(gate.gateState, "satisfied");
  assert.equal(gate.firstPaymentAmount, 1250.5);
  assert.equal(gate.firstPaymentConfirmed, true);
  assert.equal(gate.normalHandoffAllowed, true);
  assert.equal(gate.exceptionalHandoffAllowed, false);
  assert.equal(Object.isFrozen(gate), true);

  for (const malformed of [
    gateRow({ first_payment_currency: "usd" }),
    gateRow({ first_payment_amount: 1250.555 }),
    gateRow({ first_payment_due_date: "2026-02-30" }),
    gateRow({ updated_at: "2026-02-30T10:11:12+06:00" }),
    gateRow({ contract_confirmed_by_membership_id: null }),
    gateRow({ first_payment_received_date: null }),
    gateRow({ gate_state: "complete" }),
    gateRow({ normal_handoff_allowed: false }),
    gateRow({ can_confirm_contract: true }),
    gateRow({ can_confirm_first_payment: true }),
    gateRow({ can_override_gate: true }),
    gateRow({ gate_version: 0 }),
  ]) {
    assert.throws(
      () => normalizePlatformAdmissionsGate(malformed),
      PlatformAdmissionsGateRepositoryError,
    );
  }
});

test("U5 gate read uses the exact RPC and rejects malformed or foreign rows", async () => {
  const { client, calls } = rpcClient({
    staff_lead_admissions_gate: [gateRow()],
  });

  const gate = await getPlatformAdmissionsGate(actor(), LEAD_ID, { client });
  assert.equal(gate?.leadId, LEAD_ID);
  assert.deepEqual(calls, [
    {
      functionName: "staff_lead_admissions_gate",
      args: { p_lead_id: LEAD_ID },
      options: { get: true },
    },
  ]);

  for (const row of [
    gateRow({ organization_id: OTHER_ORGANIZATION_ID }),
    gateRow({ lead_id: "1ea19965-067c-4d9c-b6dd-57d854fbd155" }),
    gateRow({ updated_at: "not-a-timestamp" }),
  ]) {
    const boundary = rpcClient({ staff_lead_admissions_gate: [row] });
    await assert.rejects(
      getPlatformAdmissionsGate(actor(), LEAD_ID, { client: boundary.client }),
      (error) =>
        error instanceof PlatformAdmissionsGateRepositoryError &&
        error.kind === "invalid",
    );
  }

  const duplicate = rpcClient({
    staff_lead_admissions_gate: [gateRow(), gateRow()],
  });
  await assert.rejects(
    getPlatformAdmissionsGate(actor(), LEAD_ID, { client: duplicate.client }),
    (error) =>
      error instanceof PlatformAdmissionsGateRepositoryError &&
      error.kind === "unavailable",
  );
});

test("U5 contract confirmation sends the exact idempotent mutation arguments", async () => {
  const receiptRow = {
    ...contractConfirmedRow(),
    request_id: REQUEST_ID,
    changed_at: "2026-08-25T09:10:11.123456+06:00",
  };
  const { client, calls } = rpcClient({
    mutate_lead_admissions_gate: receiptRow,
  });

  const receipt = await mutatePlatformAdmissionsGate(
    actor(),
    {
      leadId: LEAD_ID,
      expectedGateVersion: 1,
      requestId: REQUEST_ID,
      action: "confirm_contract",
      amount: 1250.5,
      currency: "USD",
      dueDate: "2026-08-28",
      receivedDate: null,
      evidenceReference: " Договор EVO-2026-014 ",
      reason: null,
    },
    { client },
  );

  assert.equal(receipt.requestId, REQUEST_ID);
  assert.equal(receipt.gateVersion, 2);
  assert.equal(receipt.gateState, "blocked");
  assert.deepEqual(calls, [
    {
      functionName: "mutate_lead_admissions_gate",
      args: {
        p_lead_id: LEAD_ID,
        p_expected_gate_version: 1,
        p_request_id: REQUEST_ID,
        p_action: "confirm_contract",
        p_amount: 1250.5,
        p_currency: "USD",
        p_due_date: "2026-08-28",
        p_received_date: null,
        p_evidence_reference: "Договор EVO-2026-014",
        p_reason: null,
      },
      options: undefined,
    },
  ]);
});

test("U5 FormData parser enforces exact action-specific evidence", () => {
  assert.deepEqual(parsePlatformAdmissionsGateFormData(gateForm()), {
    leadId: LEAD_ID,
    expectedGateVersion: 1,
    requestId: REQUEST_ID,
    action: "confirm_contract",
    amount: 1250.5,
    currency: "USD",
    dueDate: "2026-08-28",
    receivedDate: null,
    evidenceReference: "Договор EVO-2026-014",
    reason: null,
  });

  assert.deepEqual(
    parsePlatformAdmissionsGateFormData(
      gateForm({
        expected_gate_version: "2",
        action: "confirm_first_payment",
        amount: "",
        currency: "",
        due_date: "",
        received_date: "2026-08-26",
        evidence_reference: "Квитанция PAY-019",
      }),
    ),
    {
      leadId: LEAD_ID,
      expectedGateVersion: 2,
      requestId: REQUEST_ID,
      action: "confirm_first_payment",
      amount: null,
      currency: null,
      dueDate: null,
      receivedDate: "2026-08-26",
      evidenceReference: "Квитанция PAY-019",
      reason: null,
    },
  );

  assert.deepEqual(
    parsePlatformAdmissionsGateFormData(
      gateForm({
        action: "override_gate",
        amount: "",
        currency: "",
        due_date: "",
        evidence_reference: "",
        reason: " Исключение одобрено директором ",
      }),
    ),
    {
      leadId: LEAD_ID,
      expectedGateVersion: 1,
      requestId: REQUEST_ID,
      action: "override_gate",
      amount: null,
      currency: null,
      dueDate: null,
      receivedDate: null,
      evidenceReference: null,
      reason: "Исключение одобрено директором",
    },
  );

  const duplicate = gateForm();
  duplicate.append("amount", "1250.50");
  for (const malformed of [
    duplicate,
    gateForm({ expected_gate_version: "0" }),
    gateForm({ amount: "01.00" }),
    gateForm({ amount: "1250.555" }),
    gateForm({ amount: "1e3" }),
    gateForm({ currency: "usd" }),
    gateForm({ due_date: "2026-02-30" }),
    gateForm({ evidence_reference: "" }),
    gateForm({ action: "confirm_first_payment" }),
    gateForm({ action: "override_gate", reason: "" }),
  ]) {
    assert.equal(parsePlatformAdmissionsGateFormData(malformed), null);
  }
});

test("U5 first-payment confirmation sends only received evidence", async () => {
  const receiptRow = {
    ...gateRow(),
    request_id: REQUEST_ID,
    changed_at: "2026-08-26T10:11:12.123456+06:00",
  };
  const { client, calls } = rpcClient({
    mutate_lead_admissions_gate: receiptRow,
  });

  const receipt = await mutatePlatformAdmissionsGate(
    actor(),
    {
      leadId: LEAD_ID,
      expectedGateVersion: 2,
      requestId: REQUEST_ID,
      action: "confirm_first_payment",
      amount: null,
      currency: null,
      dueDate: null,
      receivedDate: "2026-08-26",
      evidenceReference: "Квитанция PAY-019",
      reason: null,
    },
    { client },
  );

  assert.equal(receipt.firstPaymentConfirmed, true);
  assert.equal(receipt.gateState, "satisfied");
  assert.deepEqual(calls[0], {
    functionName: "mutate_lead_admissions_gate",
    args: {
      p_lead_id: LEAD_ID,
      p_expected_gate_version: 2,
      p_request_id: REQUEST_ID,
      p_action: "confirm_first_payment",
      p_amount: null,
      p_currency: null,
      p_due_date: null,
      p_received_date: "2026-08-26",
      p_evidence_reference: "Квитанция PAY-019",
      p_reason: null,
    },
    options: undefined,
  });
});

test("U5 override sends only the mandatory reason", async () => {
  const receiptRow = {
    ...overrideRow(),
    request_id: REQUEST_ID,
    changed_at: "2026-08-25T11:12:13.123456+06:00",
  };
  const { client, calls } = rpcClient({
    mutate_lead_admissions_gate: receiptRow,
  });

  const receipt = await mutatePlatformAdmissionsGate(
    actor({ platformRole: "admin", role: "admin" }),
    {
      leadId: LEAD_ID,
      expectedGateVersion: 1,
      requestId: REQUEST_ID,
      action: "override_gate",
      amount: null,
      currency: null,
      dueDate: null,
      receivedDate: null,
      evidenceReference: null,
      reason: " Исключение одобрено директором ",
    },
    { client },
  );

  assert.equal(receipt.gateState, "overridden");
  assert.equal(receipt.exceptionalHandoffAllowed, true);
  assert.deepEqual(calls[0], {
    functionName: "mutate_lead_admissions_gate",
    args: {
      p_lead_id: LEAD_ID,
      p_expected_gate_version: 1,
      p_request_id: REQUEST_ID,
      p_action: "override_gate",
      p_amount: null,
      p_currency: null,
      p_due_date: null,
      p_received_date: null,
      p_evidence_reference: null,
      p_reason: "Исключение одобрено директором",
    },
    options: undefined,
  });
});

test("U5 mutation rejects invalid actors, payloads, and untrusted receipts", async () => {
  const validInput = {
    leadId: LEAD_ID,
    expectedGateVersion: 1,
    requestId: REQUEST_ID,
    action: "override_gate",
    amount: null,
    currency: null,
    dueDate: null,
    receivedDate: null,
    evidenceReference: null,
    reason: "Одобрено",
  };

  const unusedBoundary = rpcClient();
  await assert.rejects(
    mutatePlatformAdmissionsGate(
      actor({ platformRole: "curator", role: "curator" }),
      validInput,
      { client: unusedBoundary.client },
    ),
    (error) =>
      error instanceof PlatformAdmissionsGateRepositoryError &&
      error.kind === "forbidden",
  );
  assert.equal(unusedBoundary.calls.length, 0);

  for (const malformedInput of [
    { ...validInput, expectedGateVersion: 0 },
    { ...validInput, requestId: "not-a-uuid" },
    { ...validInput, reason: "" },
    {
      ...validInput,
      action: "confirm_contract",
      amount: 10.001,
      currency: "USD",
      dueDate: "2026-08-28",
      evidenceReference: "Договор",
      reason: null,
    },
    {
      ...validInput,
      action: "confirm_first_payment",
      amount: 10,
      receivedDate: "2026-08-26",
      evidenceReference: "Квитанция",
      reason: null,
    },
  ]) {
    const boundary = rpcClient();
    await assert.rejects(
      mutatePlatformAdmissionsGate(actor(), malformedInput, {
        client: boundary.client,
      }),
      (error) =>
        error instanceof PlatformAdmissionsGateRepositoryError &&
        error.kind === "invalid",
    );
    assert.equal(boundary.calls.length, 0);
  }

  for (const receipt of [
    {
      ...overrideRow({ organization_id: OTHER_ORGANIZATION_ID }),
      request_id: REQUEST_ID,
      changed_at: "2026-08-25T11:12:13.123456+06:00",
    },
    {
      ...overrideRow(),
      request_id: "1ea19965-067c-4d9c-b6dd-57d854fbd155",
      changed_at: "2026-08-25T11:12:13.123456+06:00",
    },
    {
      ...overrideRow(),
      request_id: REQUEST_ID,
      changed_at: "not-a-timestamp",
    },
  ]) {
    const boundary = rpcClient({ mutate_lead_admissions_gate: receipt });
    await assert.rejects(
      mutatePlatformAdmissionsGate(actor(), validInput, {
        client: boundary.client,
      }),
      (error) =>
        error instanceof PlatformAdmissionsGateRepositoryError &&
        error.kind === "invalid",
    );
  }
});

test("U5 database failures map to truthful stable outcomes", async () => {
  const cases = [
    ["admissions_gate_not_found_or_forbidden", "42501", "forbidden"],
    ["admissions_gate_contract_confirmation_forbidden", "42501", "forbidden"],
    ["admissions_gate_request_id_conflict", "23505", "request_conflict"],
    ["admissions_gate_version_conflict", "PT409", "stale"],
    ["admissions_gate_contract_locked", "P0001", "stale"],
    ["admissions_gate_contract_already_confirmed", "PT409", "stale"],
    ["admissions_gate_contract_required", "PT409", "stale"],
    ["admissions_gate_first_payment_already_confirmed", "P0001", "stale"],
    ["admissions_gate_already_satisfied", "P0001", "stale"],
    ["admissions_gate_invalid_first_payment", "22023", "invalid"],
    ["admissions_gate_override_reason_required", "22023", "invalid"],
    ["internal database detail", "XX000", "unavailable"],
  ];
  const input = {
    leadId: LEAD_ID,
    expectedGateVersion: 2,
    requestId: REQUEST_ID,
    action: "confirm_first_payment",
    amount: null,
    currency: null,
    dueDate: null,
    receivedDate: "2026-08-26",
    evidenceReference: "Квитанция PAY-019",
    reason: null,
  };

  for (const [message, code, expectedKind] of cases) {
    const { client } = rpcClient(
      {},
      { mutate_lead_admissions_gate: { message, code } },
    );
    await assert.rejects(
      mutatePlatformAdmissionsGate(actor(), input, { client }),
      (error) =>
        error instanceof PlatformAdmissionsGateRepositoryError &&
        error.kind === expectedKind,
    );
  }
});

test("U5 server action guards the actor, saves, and revalidates both Sales paths", async () => {
  const harness = globalThis.__platformAdmissionsGateActionTest;
  const currentActor = actor();
  let observed = null;
  harness.actor = currentActor;
  harness.revalidated = [];
  harness.mutation = async (actorValue, input) => {
    observed = { actorValue, input };
    return {
      gateVersion: 2,
      gateState: "blocked",
      changedAt: "2026-08-25T09:10:11.123456+06:00",
    };
  };

  const state = await updatePlatformAdmissionsGateAction(
    {
      status: "idle",
      requestId: REQUEST_ID,
      gateVersion: null,
      gateState: null,
      changedAt: null,
    },
    gateForm(),
  );

  assert.equal(observed.actorValue, currentActor);
  assert.deepEqual(observed.input, {
    leadId: LEAD_ID,
    expectedGateVersion: 1,
    requestId: REQUEST_ID,
    action: "confirm_contract",
    amount: 1250.5,
    currency: "USD",
    dueDate: "2026-08-28",
    receivedDate: null,
    evidenceReference: "Договор EVO-2026-014",
    reason: null,
  });
  assert.equal(state.status, "saved");
  assert.equal(state.gateVersion, 2);
  assert.equal(state.gateState, "blocked");
  assert.notEqual(state.requestId, REQUEST_ID);
  assert.notEqual(parsePlatformAdmissionsGateUuid(state.requestId), null);
  assert.deepEqual(harness.revalidated, ["/sales", `/sales/${LEAD_ID}`]);
});

test("U5 server action preserves retry IDs and exposes repository outcomes", async () => {
  const harness = globalThis.__platformAdmissionsGateActionTest;
  harness.actor = actor();

  let mutationCalled = false;
  harness.mutation = async () => {
    mutationCalled = true;
    throw new Error("must not be reached");
  };
  const invalidForm = gateForm({ amount: "bad" });
  const invalid = await updatePlatformAdmissionsGateAction(
    {
      status: "idle",
      requestId: REQUEST_ID,
      gateVersion: null,
      gateState: null,
      changedAt: null,
    },
    invalidForm,
  );
  assert.equal(invalid.status, "invalid");
  assert.equal(invalid.requestId, REQUEST_ID);
  assert.equal(mutationCalled, false);

  for (const kind of ["forbidden", "stale", "request_conflict", "unavailable"]) {
    harness.mutation = async () => {
      throw new PlatformAdmissionsGateRepositoryError(kind);
    };
    const state = await updatePlatformAdmissionsGateAction(invalid, gateForm());
    assert.equal(state.status, kind);
    if (kind === "request_conflict") {
      assert.notEqual(state.requestId, REQUEST_ID);
      assert.notEqual(parsePlatformAdmissionsGateUuid(state.requestId), null);
    } else {
      assert.equal(state.requestId, REQUEST_ID);
    }
    assert.equal(state.gateVersion, null);
    assert.equal(state.gateState, null);
  }
});

test("U5 gate stays off the canonical Sales screen until #431 replaces it", () => {
  const detail = read(
    "src/app/(staff)/sales/[id]/SalesLeadWorkspace.tsx",
  );
  const card = read(
    "src/components/platform/sales/SalesAdmissionsGateCard.tsx",
  );
  assert.doesNotMatch(detail, /getPlatformAdmissionsGate|SalesAdmissionsGateCard/);
  assert.match(card, /data-testid="admissions-gate-state"/);
  assert.match(card, /action="confirm_contract"/);
  assert.match(card, /action="confirm_first_payment"/);
  assert.match(card, /action="override_gate"/);
  assert.match(card, /gate\.canConfirmContract/);
  assert.match(card, /gate\.canConfirmFirstPayment/);
  assert.match(card, /gate\.canOverrideGate/);
  assert.match(card, /name="evidence_reference"/);
  assert.match(card, /name="reason"/);
});
