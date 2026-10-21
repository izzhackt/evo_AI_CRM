import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { STUDENT_RECOVERY_RESPONSE_DEADLINE_MS } from "../src/lib/student-password-recovery-contract.ts";
import { answerAtFixedDeadline } from "../src/lib/student-password-recovery-timing.ts";
import {
  classifyStudentRecoveryRecipient,
  runStudentRecoveryRequest,
} from "../src/lib/server/student-recovery-request.ts";
import { findRawAuthUserByExactEmail } from "../src/lib/server/student-portal-invite-auth-provider.ts";

const STAFF_ID = "31400000-0000-4000-8000-000000000101";
const STUDENT_ID = "31400000-0000-4000-8000-000000000107";
const EMAIL = "someone@example.com";
const REDIRECT = "https://app.evoadmissions.com/auth/callback";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

/** A service client that records every RPC and answers per function name. */
function serviceClient({ lookup, membership }) {
  const calls = [];
  return {
    calls,
    schema(name) {
      return {
        async rpc(fn, args) {
          calls.push({ schema: name, fn, args });
          if (fn === "auth_user_by_exact_email_v1") return lookup(args);
          if (fn === "auth_user_has_staff_membership_v1") return membership(args);
          throw new Error(`unexpected rpc ${fn}`);
        },
      };
    },
  };
}

/** What the database returns for a found user: ids and the two markers only. */
function authUser(id, markers = {}) {
  return {
    id,
    email: EMAIL,
    email_confirmed_at: "2026-09-08T00:00:00.000000Z",
    confirmed_at: "2026-09-08T00:00:00.000000Z",
    confirmation_sent_at: null,
    invited_at: null,
    app_metadata: markers.app ?? {},
    user_metadata: markers.user ?? {},
  };
}

const ok = (data) => async () => ({ data, error: null });
const failed = (error) => async () => ({ data: null, error });
const notCalled = () => {
  throw new Error("must not be called");
};

test("point lookup: one RPC by exact address, no Auth Admin list scan", async () => {
  const client = serviceClient({ lookup: ok(authUser(STUDENT_ID)), membership: notCalled });
  const found = await findRawAuthUserByExactEmail(client, EMAIL);
  assert.equal(found.status, "found");
  assert.equal(found.user.id, STUDENT_ID);
  assert.deepEqual(client.calls, [
    { schema: "platform", fn: "auth_user_by_exact_email_v1", args: { p_email: EMAIL } },
  ]);
  // Nobody; an RPC error (also: the function is missing); an ambiguous address;
  // a different address than asked for; a malformed answer; a thrown call.
  assert.deepEqual(
    await findRawAuthUserByExactEmail(serviceClient({ lookup: ok(null), membership: notCalled }), EMAIL),
    { status: "missing", user: null },
  );
  for (const bad of [
    failed({ status: 404, code: "PGRST202" }),
    failed({ status: 500, code: "21000", message: "auth_user_email_ambiguous" }),
    failed({ status: 400, code: "22023", message: "auth_user_email_invalid" }),
    ok({ ...authUser(STUDENT_ID), email: "other@example.com" }),
    ok({ ...authUser("not-a-uuid") }),
    ok("a string"),
    ok([authUser(STUDENT_ID)]),
    ok(undefined),
    async () => {
      throw new Error("network");
    },
  ]) {
    assert.deepEqual(
      await findRawAuthUserByExactEmail(serviceClient({ lookup: bad, membership: notCalled }), EMAIL),
      { status: "unavailable", user: null },
    );
  }
  // Address case on the Auth side does not matter, the match is on the lower-cased address.
  const mixed = await findRawAuthUserByExactEmail(
    serviceClient({ lookup: ok({ ...authUser(STUDENT_ID), email: "Someone@Example.com" }), membership: notCalled }),
    EMAIL,
  );
  assert.equal(mixed.status, "found");
});

test("recipient: a staff account WITHOUT a marker is recognised by its membership", async () => {
  const client = serviceClient({ lookup: ok(authUser(STAFF_ID)), membership: ok(true) });
  assert.deepEqual(await classifyStudentRecoveryRecipient(client, EMAIL), {
    status: "staff",
    basis: "membership",
  });
  assert.deepEqual(client.calls.map(({ fn, args }) => [fn, args]), [
    ["auth_user_by_exact_email_v1", { p_email: EMAIL }],
    ["auth_user_has_staff_membership_v1", { p_auth_user_id: STAFF_ID }],
  ]);
  assert.ok(client.calls.every(({ schema }) => schema === "platform"));
});

test("recipient: the provisioning markers still count and need no second question", async () => {
  for (const markers of [
    { app: { evo_staff_password_request_id: "r1" } },
    { user: { evo_staff_invitation_request_id: "r2" } },
  ]) {
    const client = serviceClient({ lookup: ok(authUser(STAFF_ID, markers)), membership: notCalled });
    assert.deepEqual(await classifyStudentRecoveryRecipient(client, EMAIL), {
      status: "staff",
      basis: "marker",
    });
    assert.equal(client.calls.length, 1);
  }
});

test("recipient: a Student and an unknown address are alike", async () => {
  const student = serviceClient({ lookup: ok(authUser(STUDENT_ID)), membership: ok(false) });
  assert.deepEqual(await classifyStudentRecoveryRecipient(student, EMAIL), { status: "other" });
  assert.equal(student.calls.length, 2);
  const unknown = serviceClient({ lookup: ok(null), membership: notCalled });
  assert.deepEqual(await classifyStudentRecoveryRecipient(unknown, EMAIL), { status: "other" });
  // An unknown address asks no membership question: there is no user id.
  assert.deepEqual(unknown.calls.map(({ fn }) => fn), ["auth_user_by_exact_email_v1"]);
});

test("recipient: any failure is unavailable (closed), never «other»", async () => {
  const lookupDown = serviceClient({ lookup: failed({ status: 500 }), membership: notCalled });
  assert.deepEqual(await classifyStudentRecoveryRecipient(lookupDown, EMAIL), {
    status: "unavailable",
    stage: "lookup",
  });
  for (const membership of [
    failed({ status: 404, code: "PGRST202" }),
    failed({ status: 500 }),
    ok(null),
    ok("true"),
    ok(1),
    ok(undefined),
    async () => {
      throw new Error("network");
    },
  ]) {
    assert.deepEqual(
      await classifyStudentRecoveryRecipient(
        serviceClient({ lookup: ok(authUser(STAFF_ID)), membership }),
        EMAIL,
      ),
      { status: "unavailable", stage: "membership" },
    );
  }
});

/** Ports with a recorded send and a recipient that answers after `recipientMs`. */
function ports({ recipient, send, recipientMs = 0, sendMs = 0 }) {
  const events = { sends: [], logs: [] };
  return {
    events,
    ports: {
      recipient: async () => {
        if (recipientMs) await new Promise((resolve) => setTimeout(resolve, recipientMs));
        if (recipient instanceof Error) throw recipient;
        return recipient;
      },
      sendEmail: async (email, redirectTo) => {
        events.sends.push([email, redirectTo]);
        if (sendMs) await new Promise((resolve) => setTimeout(resolve, sendMs));
        if (send instanceof Error) throw send;
        return { error: send ?? null };
      },
      log: (stage, error) => events.logs.push([stage, error?.code ?? null]),
    },
  };
}

test("request: staff without a marker get the neutral «sent» and no Auth call", async () => {
  const { ports: p, events } = ports({ recipient: { status: "staff", basis: "membership" } });
  assert.equal(await runStudentRecoveryRequest(p, EMAIL, REDIRECT), "sent");
  assert.deepEqual(events.sends, []);
  assert.deepEqual(events.logs, [["request_staff_skipped_membership", null]]);
  const marked = ports({ recipient: { status: "staff", basis: "marker" } });
  assert.equal(await runStudentRecoveryRequest(marked.ports, EMAIL, REDIRECT), "sent");
  assert.deepEqual(marked.events.sends, []);
  assert.deepEqual(marked.events.logs, [["request_staff_skipped", null]]);
});

test("request: a Student and an unknown address (both «other») reach Auth once and get «sent»", async () => {
  const { ports: p, events } = ports({ recipient: { status: "other" } });
  assert.equal(await runStudentRecoveryRequest(p, EMAIL, REDIRECT), "sent");
  assert.deepEqual(events.sends, [[EMAIL, REDIRECT]]);
  assert.deepEqual(events.logs, []);
  // Auth answers keep their former classification.
  const limited = ports({ recipient: { status: "other" }, send: { status: 429, code: "over_request_rate_limit" } });
  assert.equal(await runStudentRecoveryRequest(limited.ports, EMAIL, REDIRECT), "rate_limited");
  const capped = ports({ recipient: { status: "other" }, send: { status: 429, code: "over_email_send_rate_limit" } });
  assert.equal(await runStudentRecoveryRequest(capped.ports, EMAIL, REDIRECT), "sent");
  const down = ports({ recipient: { status: "other" }, send: new Error("network") });
  assert.equal(await runStudentRecoveryRequest(down.ports, EMAIL, REDIRECT), "unavailable");
});

test("request: a failed lookup is «unavailable», a failed membership question is neutral; nothing is sent", async () => {
  const lookup = ports({ recipient: { status: "unavailable", stage: "lookup" } });
  assert.equal(await runStudentRecoveryRequest(lookup.ports, EMAIL, REDIRECT), "unavailable");
  assert.deepEqual(lookup.events.sends, []);
  assert.deepEqual(lookup.events.logs, [["request_lookup", null]]);
  // Asked only about an existing account: «unavailable» here would tell it from an unknown address.
  const membership = ports({ recipient: { status: "unavailable", stage: "membership" } });
  assert.equal(await runStudentRecoveryRequest(membership.ports, EMAIL, REDIRECT), "sent");
  assert.deepEqual(membership.events.sends, []);
  assert.deepEqual(membership.events.logs, [["request_membership", null]]);
  const thrown = ports({ recipient: new Error("boom") });
  assert.equal(await runStudentRecoveryRequest(thrown.ports, EMAIL, REDIRECT), "unavailable");
  assert.deepEqual(thrown.events.sends, []);
});

test("request: staff, Student and unknown address are held to one fixed answer time", async () => {
  const deadlineMs = 220;
  const run = async (options) => {
    const startedAt = Date.now();
    const { ports: p, events } = ports(options);
    const status = await answerAtFixedDeadline({
      work: runStudentRecoveryRequest(p, EMAIL, REDIRECT),
      startedAt,
      deadlineMs,
      pending: "sent",
    });
    return { status, elapsed: Date.now() - startedAt, events };
  };
  // Staff: the lookups only, no Auth call, answered fast. Student: a real send of 90 ms.
  // Unknown: a quick Auth answer. All three leave at the deadline, none earlier.
  const [staff, student, unknown] = await Promise.all([
    run({ recipient: { status: "staff", basis: "membership" }, recipientMs: 15 }),
    run({ recipient: { status: "other" }, recipientMs: 15, sendMs: 90 }),
    run({ recipient: { status: "other" }, recipientMs: 15, sendMs: 5 }),
  ]);
  for (const result of [staff, student, unknown]) {
    assert.equal(result.status, "sent");
    assert.ok(result.elapsed >= deadlineMs - 5, `answered early: ${result.elapsed} ms`);
    assert.ok(result.elapsed < deadlineMs + 100, `answered late: ${result.elapsed} ms`);
  }
  assert.equal(staff.events.sends.length, 0);
  assert.equal(student.events.sends.length, 1);
  assert.equal(unknown.events.sends.length, 1);
  assert.ok(STUDENT_RECOVERY_RESPONSE_DEADLINE_MS >= 1_500);
});

test("wiring: the server flow uses the point lookup and the membership question before Auth", () => {
  const server = source("src/lib/server/student-password-recovery.ts");
  const request = source("src/lib/server/student-recovery-request.ts");
  const provider = source("src/lib/server/student-portal-invite-auth-provider.ts");
  const actions = source("src/lib/student-password-recovery-actions.ts");

  assert.match(server, /classifyStudentRecoveryRecipient\(service, normalizedEmail\)/u);
  assert.match(server, /runStudentRecoveryRequest\(/u);
  assert.match(server, /resetPasswordForEmail\(address, \{ redirectTo: target \}\)/u);
  // The membership question is asked after the lookup, before anything is sent.
  const lookup = request.indexOf("findRawAuthUserByExactEmail(service, normalizedEmail)");
  const marker = request.indexOf("hasStaffRecoveryMarker(found.user, undefined)");
  const member = request.indexOf("readStaffMembership(service, String(found.user.id))");
  const recipient = request.indexOf("await ports.recipient(email)");
  const send = request.indexOf("await ports.sendEmail(email, redirectTo)");
  assert.ok(lookup > 0 && marker > lookup && member > marker, "lookup, marker, then membership");
  assert.ok(recipient > 0 && send > recipient, "the recipient is decided before the email is sent");
  assert.match(request, /rpc\("auth_user_has_staff_membership_v1", \{ p_auth_user_id: authUserId \}\)/u);
  assert.match(provider, /rpc\("auth_user_by_exact_email_v1", \{ p_email: normalizedEmail \}\)/u);
  // No Admin API user scan is left in the recovery or invite paths.
  for (const text of [server, request, provider]) assert.doesNotMatch(text, /\.listUsers\(/u);
  // The action still holds every account-dependent answer to the fixed deadline.
  assert.match(actions, /answerAtFixedDeadline<RequestStatus>\(\{[^}]*deadlineMs: STUDENT_RECOVERY_RESPONSE_DEADLINE_MS,[^}]*pending: "sent",/u);
  assert.doesNotMatch(actions, /await requestStatus\(/u);
});

test("migration 314 grants both functions to service_role only", () => {
  const sql = source("supabase/migrations/314_platform_password_recovery_staff_check.sql");
  assert.match(sql, /REVOKE ALL ON FUNCTION platform\.auth_user_has_staff_membership_v1\(UUID\),\s*platform\.auth_user_by_exact_email_v1\(TEXT\)\s*FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;/u);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION platform\.auth_user_has_staff_membership_v1\(UUID\) TO service_role;/u);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION platform\.auth_user_by_exact_email_v1\(TEXT\) TO service_role;/u);
  assert.doesNotMatch(sql, /GRANT[^;]*\b(authenticated|anon|PUBLIC)\b[^;]*;/iu);
  assert.equal((sql.match(/SECURITY DEFINER SET search_path = ''/gu) ?? []).length, 2);
});
