// Экран «Конфиденциальность» при первом входе (решение владельца 09.11.2026, миграция 356). Сторону базы (версии,
// идемпотентность, откат, права, журнал) доказывает supabase/tests/platform_student_consent_gate.sql; здесь - чистые
// правила, транспорт RPC, действие формы против подделок клиентов, проводка слоя кабинета, прокси и словари.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

import { STUDENT_APPLICATION_CONSENT_VERSION } from "../src/lib/student-application-contract.ts";
import { AI_CONSENT_POLICY_VERSION, AI_CONSENT_PRIVACY_URL } from "../src/lib/portal/ai-consent.ts";
import {
  CONSENT_GATE_PATH,
  CONSENT_GATE_PATH_HEADER,
  CONSENT_GATE_SOURCE,
  PRIVACY_POLICY_VERSION,
  consentGateDestination,
  consentGateRequired,
  isConsentGatePath,
  isConsentRequestId,
  parseConsentStatus,
  safeConsentReturnPath,
} from "../src/lib/portal/consent-gate.ts";
import { acceptConsentsFrom, acceptConsentsWith, readConsentStatusFrom, readConsentStatusWith } from "../src/lib/portal/consent-gate-rpc.ts";
import { PORTAL_DICTIONARIES } from "../src/lib/portal/i18n.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const code = (path) => read(path).replace(/\/\*[\s\S]*?\*\//gu, "").replace(/^\s*\/\/.*$/gmu, "");

const REQUEST_ID = "5b1a6c52-7a0e-4f0a-9d0e-2f3b9d8f4c11";
const NEW_STUDENT = {
  policyVersionCurrent: "2026-11-07", policyAcceptedVersion: null, aiStatus: null, aiPolicyVersion: null,
  aiPolicyVersionCurrent: "2026-10-25", needsDecision: true,
};
const DONE = {
  ...NEW_STUDENT, policyAcceptedVersion: "2026-11-07", aiStatus: "granted", aiPolicyVersion: "2026-10-25", needsDecision: false,
};

function fakeClient(result) {
  const calls = [];
  return {
    calls,
    schema(name) {
      return { rpc(fn, args) { calls.push({ schema: name, fn, args }); return Promise.resolve(typeof result === "function" ? result(fn, args) : result); } };
    },
  };
}

test("the versions are the ones the application checkbox and the AI consent already use", () => {
  assert.equal(PRIVACY_POLICY_VERSION, STUDENT_APPLICATION_CONSENT_VERSION);
  assert.equal(PRIVACY_POLICY_VERSION, "2026-11-07");
  assert.equal(AI_CONSENT_POLICY_VERSION, "2026-10-25");
  assert.equal(CONSENT_GATE_SOURCE, "portal_web");
  assert.equal(CONSENT_GATE_PATH, "/portal/privacy");
  assert.equal(AI_CONSENT_PRIVACY_URL, "https://evoadmissions.com/ru/privacy/");
});

test("the status answer is parsed strictly: exactly six fields, no invented state", () => {
  assert.deepEqual(parseConsentStatus(NEW_STUDENT), NEW_STUDENT);
  assert.deepEqual(parseConsentStatus(DONE), DONE);
  assert.deepEqual(parseConsentStatus({ ...DONE, aiStatus: "declined" })?.aiStatus, "declined");
  for (const bad of [null, undefined, [], "x", 1, { ...DONE, extra: 1 }, { ...DONE, needsDecision: "false" }, { ...DONE, aiStatus: "maybe" },
    { ...DONE, aiStatus: "granted", aiPolicyVersion: null }, { ...NEW_STUDENT, aiPolicyVersion: "2026-10-25" },
    { ...DONE, policyVersionCurrent: "bad version" }, { ...DONE, policyAcceptedVersion: 7 }]) {
    assert.equal(parseConsentStatus(bad), null, JSON.stringify(bad));
  }
  const { needsDecision, ...missing } = DONE;
  assert.equal(needsDecision, false);
  assert.equal(parseConsentStatus(missing), null);
});

test("the gate shows only when the database asks AND this release knows the versions (no screen that cannot close)", () => {
  assert.equal(consentGateRequired(NEW_STUDENT), true);
  assert.equal(consentGateRequired(DONE), false, "a decision, including a later revoke, is no gate");
  assert.equal(consentGateRequired({ ...DONE, aiStatus: "declined" }), false);
  assert.equal(consentGateRequired({ ...NEW_STUDENT, policyVersionCurrent: "2027-01-01" }), false, "version drift never locks the cabinet");
  assert.equal(consentGateRequired({ ...NEW_STUDENT, aiPolicyVersionCurrent: "2027-01-01" }), false);
});

test("the return path is a cabinet path only; anything else goes to /portal", () => {
  assert.equal(safeConsentReturnPath("/portal/documents"), "/portal/documents");
  assert.equal(safeConsentReturnPath("/portal/universities/country/cn?x=1#a"), "/portal/universities/country/cn?x=1#a");
  assert.equal(safeConsentReturnPath("/portal"), "/portal");
  for (const bad of [undefined, null, "", 5, "https://evil.example/portal", "//evil.example", "/portalx", "/portal\\evil", "/portal/\u0000", "/staff", "/login",
    "/portal/privacy", "/portal/privacy?next=/portal", "/portal/privacy/", "javascript:alert(1)", "/portal" + "a".repeat(600), "portal"]) {
    assert.equal(safeConsentReturnPath(bad), "/portal", String(bad).slice(0, 40));
  }
  assert.equal(consentGateDestination("/portal/documents?tab=a"), "/portal/privacy?next=%2Fportal%2Fdocuments%3Ftab%3Da");
  assert.equal(consentGateDestination("/portal"), "/portal/privacy");
  assert.equal(consentGateDestination(null), "/portal/privacy");
  assert.equal(consentGateDestination("//evil.example"), "/portal/privacy");
  assert.equal(isConsentGatePath("/portal/privacy"), true);
  assert.equal(isConsentGatePath("/portal/privacy?next=%2Fportal"), true);
  assert.equal(isConsentGatePath("/portal/profile"), false);
  assert.equal(isConsentGatePath("/portal/privacy-x"), false);
  assert.equal(isConsentGatePath(null), false);
  assert.equal(isConsentRequestId(REQUEST_ID), true);
  assert.equal(isConsentRequestId("nope"), false);
});

test("the transport sends the exact RPC arguments and trusts only a confirming answer", async () => {
  const client = fakeClient({ data: NEW_STUDENT, error: null });
  assert.deepEqual(await readConsentStatusWith(client), NEW_STUDENT);
  assert.deepEqual(client.calls, [{ schema: "platform", fn: "portal_consent_status_v1", args: undefined }]);
  assert.equal(await readConsentStatusWith(fakeClient({ data: null, error: { code: "42501" } })), null);
  assert.equal(await readConsentStatusFrom(() => Promise.reject(new Error("no session"))), null);

  const accept = fakeClient({ data: DONE, error: null });
  assert.deepEqual(await acceptConsentsWith(accept, REQUEST_ID), { ok: true, status: DONE });
  assert.deepEqual(accept.calls, [{ schema: "platform", fn: "portal_consents_accept_v1", args: {
    p_policy_version: "2026-11-07", p_ai_policy_version: "2026-10-25", p_source: "portal_web", p_request_id: REQUEST_ID,
  } }]);
  // No call without a request id; an error, a still-open answer or a revoked AI choice is a refusal, not a success.
  const untouched = fakeClient({ data: DONE, error: null });
  assert.deepEqual(await acceptConsentsWith(untouched, "nope"), { ok: false });
  assert.deepEqual(untouched.calls, []);
  for (const answer of [{ data: null, error: { code: "22023" } }, { data: NEW_STUDENT, error: null }, { data: { ...DONE, aiStatus: "declined" }, error: null },
    { data: { ...DONE, policyAcceptedVersion: "2026-09-18" }, error: null }, { data: { ...DONE, extra: 1 }, error: null }]) {
    assert.deepEqual(await acceptConsentsWith(fakeClient(answer), REQUEST_ID), { ok: false });
  }
  assert.deepEqual(await acceptConsentsFrom(() => Promise.reject(new Error("no session")), REQUEST_ID), { ok: false });
  assert.doesNotMatch(code("src/lib/portal/consent-gate-rpc.ts"), /auth\.uid|getUser|userId|user_id/u, "the database derives the student itself");
});

function compile(path, dependencies = {}) {
  const output = ts.transpileModule(read(path), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const compiled = { exports: {} };
  new Function("require", "module", "exports", output)((name) => {
    if (name === "server-only") return {};
    if (!Object.hasOwn(dependencies, name)) throw new Error(`Unexpected dependency: ${name}`);
    return dependencies[name];
  }, compiled, compiled.exports);
  return compiled.exports;
}

function action({ rpc = { data: DONE, error: null }, authed = true } = {}) {
  const events = [];
  const client = fakeClient(rpc);
  const subject = compile("src/lib/portal/consent-gate-actions.ts", {
    "next/navigation": { redirect: (path) => { events.push(["redirect", path]); throw Object.assign(new Error("redirect"), { path }); } },
    "../server/action-form-fields.ts": compile("src/lib/server/action-form-fields.ts"),
    "../student-portal-guards": { requireStudentPortalActor: async () => { if (!authed) throw new Error("guard"); events.push(["guard"]); return {}; } },
    "../supabase/server": { createSupabaseServerClient: async () => client },
    "./consent-gate-rpc.ts": { acceptConsentsFrom: async (open, id) => acceptConsentsFrom(open, id) },
    "./consent-gate.ts": compile("src/lib/portal/consent-gate.ts", {
      "../student-application-contract.ts": { STUDENT_APPLICATION_CONSENT_VERSION },
      "./ai-consent.ts": { AI_CONSENT_POLICY_VERSION },
    }),
  });
  const submit = async (fields = {}) => {
    const form = new FormData();
    const all = { policy_consent: "granted", ai_consent: "granted", request_id: REQUEST_ID, next: "/portal/documents", ...fields };
    for (const [key, value] of Object.entries(all)) if (value !== undefined) form.set(key, value);
    try {
      return await subject.acceptOwnConsentsAction({ status: "idle" }, form);
    } catch (error) {
      if (typeof error?.path === "string") return { redirect: error.path };
      throw error;
    }
  };
  return { client, events, submit };
}

test("the action needs both boxes, a frozen request id and a signed-in student; success goes back where the student was going", async () => {
  const ok = action();
  assert.deepEqual(await ok.submit(), { redirect: "/portal/documents" });
  assert.equal(ok.client.calls.length, 1);
  assert.equal(ok.client.calls[0].args.p_request_id, REQUEST_ID);
  assert.equal(ok.events[0][0], "guard", "the guard runs first");

  for (const fields of [{ policy_consent: "" }, { ai_consent: "" }, { policy_consent: "on" }, { ai_consent: "yes" }]) {
    const run = action();
    assert.deepEqual(await run.submit(fields), { status: "needs_both" }, JSON.stringify(fields));
    assert.equal(run.client.calls.length, 0, "nothing is written without both boxes");
  }
  const badId = action();
  assert.deepEqual(await badId.submit({ request_id: "x" }), { status: "unavailable" });
  assert.equal(badId.client.calls.length, 0);
  // A missing or extra field is refused whole.
  assert.deepEqual(await action().submit({ request_id: undefined }), { status: "unavailable" });
  assert.deepEqual(await action().submit({ extra: "1" }), { status: "unavailable" });
  // A forged return address cannot leave the cabinet.
  assert.deepEqual(await action().submit({ next: "https://evil.example/" }), { redirect: "/portal" });
  assert.deepEqual(await action().submit({ next: "/portal/privacy" }), { redirect: "/portal" });
  // A database refusal is an honest failure, no redirect; no session throws before any write.
  const refused = action({ rpc: { data: null, error: { code: "42501" } } });
  assert.deepEqual(await refused.submit(), { status: "unavailable" });
  const anonymous = action({ authed: false });
  await assert.rejects(anonymous.submit());
  assert.equal(anonymous.client.calls.length, 0);
});

test("the cabinet layer gates every cabinet page except the screen, in the right order, and fails open on a read failure", () => {
  const layout = read("src/app/(portal)/layout.tsx");
  const temp = layout.indexOf("redirect(NEW_PASSWORD_PATH)");
  const gate = layout.indexOf("redirect(consentGateDestination(requestedPath))");
  const bare = layout.indexOf("if (gatePage) return");
  const shell = layout.indexOf("<Shell");
  assert.ok(temp > 0 && gate > temp && bare > gate && shell > bare, "temporary password, then the gate, then the bare screen, then the shell");
  assert.match(layout, /readOwnConsentStatus\(\)\.catch\(\(\): null => null\)/u, "a failed read does not lock the cabinet");
  assert.match(layout, /gatePage \? Promise\.resolve\(null\) : readOwnConsentStatus/u, "the screen itself never reads (no loop)");
  assert.match(layout, /consentStatus !== null && consentGateRequired\(consentStatus\)/u);
  assert.match(layout, /CONSENT_GATE_PATH_HEADER/u);
  // The screen page: no shell of its own, redirects a decided student back, offers logout.
  const page = read("src/app/(portal)/portal/privacy/page.tsx");
  assert.match(page, /if \(status !== null && !consentGateRequired\(status\)\) redirect\(next\)/u);
  assert.match(page, /safeConsentReturnPath/u);
  assert.match(page, /logoutStudentPortalAction/u);
  assert.match(page, /data-testid="consent-gate"/u);
  assert.match(page, /robots: \{ index: false, follow: false \}/u);
});

test("the proxy stamps the requested path itself and the screen is a connected student page", () => {
  const proxy = read("src/proxy.ts");
  assert.ok(proxy.includes(`requestHeaders.set("${CONSENT_GATE_PATH_HEADER}", `), "the proxy sets the header the layer reads");
  assert.ok(proxy.indexOf(`requestHeaders.set("${CONSENT_GATE_PATH_HEADER}", `) > proxy.indexOf('requestHeaders.set("x-request-id", id)'));
  assert.equal(CONSENT_GATE_PATH_HEADER, "x-evo-pathname");
  assert.match(read("src/lib/platform-route-contract.ts"), /"\/portal\/privacy",/u);
});

test("the Home card is gone, the Profile revoke stays", () => {
  assert.doesNotMatch(read("src/app/(portal)/portal/page.tsx"), /AiConsentHomeCard|readOwnAiConsent/u);
  assert.doesNotMatch(read("src/components/portal/consent/AiConsent.tsx"), /AiConsentHomeCard/u);
  assert.match(read("src/app/(portal)/portal/profile/page.tsx"), /<AiConsentSettingsRow /u);
});

test("RU and KY carry the same keys, the owner's wording, the policy link and no reviewed claim", () => {
  const { ru, ky } = PORTAL_DICTIONARIES.consentGate;
  assert.deepEqual(Object.keys(ky).sort(), Object.keys(ru).sort());
  for (const [key, value] of Object.entries(ky)) assert.notEqual(value.trim(), "", key);
  assert.equal(ru.title, "Конфиденциальность");
  assert.equal(ru.aiLabel, "Разрешаю ИИ-помощникам EVO читать мою переписку и документы дела");
  assert.equal(ru.policyLabel, "Принимаю {policy}");
  assert.equal(ru.policyLink, "политику конфиденциальности");
  assert.ok(ky.policyLabel.includes("{policy}"));
  for (const name of ["Anthropic", "Claude", "Google", "Gemini"]) assert.ok(ru.aiDetail.includes(name) && ky.aiDetail.includes(name), name);
  const dictionary = read("src/lib/portal/i18n.ts");
  const block = dictionary.slice(dictionary.indexOf("const consentGateKy"), dictionary.indexOf("export const PORTAL_DICTIONARIES"));
  assert.doesNotMatch(block, /проверен(?!ой)|reviewed/iu);
});

test("the password screens carry the same two required boxes and the action refuses without them", () => {
  const boxes = read("src/components/student-application/ConsentGateBoxes.tsx");
  assert.equal((boxes.match(/type="checkbox" required/gu) ?? []).length, 2);
  assert.match(boxes, /name="policy_consent"/u);
  assert.match(boxes, /name="ai_consent"/u);
  assert.match(read("src/components/student-application/NewPasswordForm.tsx"), /<ConsentGateBoxes locale=\{locale\} \/>/u);
  assert.match(read("src/components/StudentSetPasswordForm.tsx"), /<ConsentGateBoxes locale="ru" \/>/u);
  // The anketa already carries both required boxes for registration and for a signed-in student.
  const wizard = read("src/components/student-application/ApplicationWizard.tsx");
  assert.equal((wizard.match(/<input type="checkbox" required checked=\{(values\.consent|aiConsent)\}/gu) ?? []).length, 2);
  assert.match(read("src/lib/student-signup-actions.ts"), /fields\.get\("ai_consent"\) !== "granted"/u);
});
