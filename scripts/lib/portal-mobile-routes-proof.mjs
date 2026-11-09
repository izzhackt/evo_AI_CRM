import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";

const RECOVERY_MIN_MS = 1500;
const SESSION_FAILURE_MIN_MS = 1000;

function draft(requestId, overrides = {}) {
  return {
    schemaVersion: 1, requestId, firstName: "Мобильный", lastName: "Проверка", phone: "+996 555 112233",
    destinationCountries: ["CN", "MY"], intakeSeason: "autumn", intakeYear: 2027, educationLevel: "high_school",
    averageGrade: 4.5, gradeScale: "5", studyFields: ["Инженерия"], studyLevels: ["bachelor"], nationality: "KG",
    english: { mode: "self", level: "intermediate" }, tuitionBudget: "5000_10000", fundingSource: "family",
    consent: true, consentVersion: "2026-11-07", ...overrides,
  };
}

/**
 * Real local Auth + Postgres + Storage + the real Next.js route handlers. Each check is isolated: a failing check is
 * recorded and the run goes on, so one run shows every result. Secrets and tokens are never part of the evidence.
 */
export async function runPortalMobileRoutesProof({ origin, apiUrl, publishableKey, mailpitOrigin, dbUrl, serviceKey, fixture, staff }) {
  const sql = postgres(dbUrl, { max: 2, onnotice: () => {} });
  const service = createClient(apiUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const anon = () => createClient(apiUrl, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const results = [];
  let ipCounter = 0;
  const nextIp = () => `203.0.113.${++ipCounter}`;

  async function call(path, { method = "POST", body, headers = {}, rawBody, ip = nextIp(), contentType = "application/json" } = {}) {
    const started = Date.now();
    const response = await fetch(`${origin}${path}`, {
      method, redirect: "manual",
      headers: { ...(body !== undefined || rawBody !== undefined ? { "content-type": contentType } : {}), "x-forwarded-for": ip, ...headers },
      body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
    });
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: response.status, json, text, ms: Date.now() - started, headers: response.headers };
  }
  const session = (login, password, extra = {}) => call("/api/portal/mobile/session", { body: { login, password }, ...extra });
  const passwordChange = (token, body, extra = {}) => call("/api/portal/mobile/password", { body, headers: { authorization: `Bearer ${token}` }, ...extra });
  const authorityOf = async (token) => {
    const client = createClient(apiUrl, publishableKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
    const { data, error } = await client.schema("platform").rpc("current_actor_authority");
    return { error, role: Array.isArray(data) ? data[0]?.platform_role : data?.platform_role };
  };
  const refresh = async (refreshToken) => {
    const { data, error } = await anon().auth.refreshSession({ refresh_token: refreshToken });
    return { ok: !error && Boolean(data.session), session: data?.session ?? null };
  };
  const mails = async () => {
    const response = await fetch(`${mailpitOrigin}/api/v1/messages?limit=500`);
    assert.ok(response.ok, "MAILPIT_UNAVAILABLE");
    return (await response.json()).messages ?? [];
  };
  const mailCount = async (address) => (await mails()).filter((m) => m.To?.some((to) => to.Address.toLowerCase() === address.toLowerCase())).length;
  async function waitForMail(address, before = 0, timeoutMs = 30_000) {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      if ((await mailCount(address)) > before) return true;
      await delay(500);
    }
    return false;
  }
  const usersWithEmail = async (email) => (await sql`SELECT count(*)::int AS n FROM auth.users WHERE lower(email)=${email.toLowerCase()}`)[0].n;
  const sessionsOf = async (userId) => (await sql`SELECT count(*)::int AS n FROM auth.sessions WHERE user_id=${userId}`)[0].n;

  async function check(id, title, fn) {
    try {
      const evidence = await fn();
      results.push({ id, title, pass: true, evidence });
      console.log(`PASS ${id} ${title} :: ${evidence}`);
    } catch (error) {
      results.push({ id, title, pass: false, evidence: String(error.message ?? error).replace(/\s+/g, " ").slice(0, 300) });
      console.log(`FAIL ${id} ${title} :: ${String(error.message ?? error).replace(/\s+/g, " ").slice(0, 300)}`);
    }
  }

  const { main, other, pwd, temp } = fixture.students;
  const reg = fixture.registration;
  const FLOW = { "X-EVO-Registration-Flow": "email-confirmation-v2" };
  const registrationBody = (email, overrides = {}) => ({
    questionnaire: draft(randomUUID()), email, password: `${randomUUID()}Aa1!`, invite: reg.token, aiConsent: true, ...overrides,
  });
  const staffSessionLogin = { email: staff.email, password: staff.password };

  try {
    // ---------------- S1 ----------------
    await check("S1.1", "flow v1 header and missing header -> 426, no auth user", async () => {
      const email = `v1-${randomUUID()}@mobile.local.test`;
      const v1 = await call("/api/portal/registration", { body: registrationBody(email), headers: { "X-EVO-Registration-Flow": "email-confirmation-v1" } });
      const none = await call("/api/portal/registration", { body: registrationBody(email) });
      assert.equal(v1.status, 426); assert.equal(none.status, 426);
      assert.equal(await usersWithEmail(email), 0);
      return `v1=${v1.status} none=${none.status} users=0`;
    });
    await check("S1.2", "v2 without a valid invite -> refused, no auth user", async () => {
      const email = `noinv-${randomUUID()}@mobile.local.test`;
      const empty = await call("/api/portal/registration", { body: registrationBody(email, { invite: "" }), headers: FLOW });
      const unknown = await call("/api/portal/registration", { body: registrationBody(email, { invite: "A".repeat(32) }), headers: FLOW });
      const omitted = await call("/api/portal/registration", { body: (({ invite, ...rest }) => rest)(registrationBody(email)), headers: FLOW });
      const noConsent = await call("/api/portal/registration", { body: registrationBody(email, { aiConsent: false }), headers: FLOW });
      const oldConsent = await call("/api/portal/registration", { body: registrationBody(email, { questionnaire: draft(randomUUID(), { consentVersion: "2026-09-18" }) }), headers: FLOW });
      assert.equal(empty.status, 403); assert.equal(empty.json.status, "invite");
      assert.equal(unknown.status, 403); assert.equal(unknown.json.status, "invite");
      assert.equal(omitted.status, 400); assert.equal(noConsent.status, 400); assert.equal(oldConsent.status, 400);
      assert.equal(await usersWithEmail(email), 0);
      return `empty=${empty.status}/${empty.json.status} unknown=${unknown.status}/${unknown.json.status} omitted=${omitted.status} aiConsent=false:${noConsent.status} oldConsentVersion:${oldConsent.status} users=0`;
    });
    await check("S1.3", "v2 with a valid personal invite + consents -> account, confirmation mail, invite consumed; reuse -> 403", async () => {
      const before = await mailCount(reg.email);
      const created = await call("/api/portal/registration", { body: registrationBody(reg.email), headers: FLOW });
      assert.equal(created.status, 202, `status ${created.status} ${created.text.slice(0, 120)}`);
      assert.equal(created.json.status, "pending_confirmation");
      assert.equal(await usersWithEmail(reg.email), 1);
      const mailed = await waitForMail(reg.email, before);
      assert.ok(mailed, "no confirmation email in the local mailbox");
      const [{ n: consumed }] = await sql`SELECT count(*)::int AS n FROM platform_private.student_registration_links WHERE used_at IS NOT NULL AND used_by_auth_user_id IN (SELECT id FROM auth.users WHERE lower(email)=${reg.email.toLowerCase()})`;
      assert.equal(consumed, 1);
      const [{ n: logins }] = await sql`SELECT count(*)::int AS n FROM platform_private.student_logins WHERE auth_user_id IN (SELECT id FROM auth.users WHERE lower(email)=${reg.email.toLowerCase()})`;
      const second = `second-${randomUUID()}@mobile.local.test`;
      const again = await call("/api/portal/registration", { body: registrationBody(second), headers: FLOW });
      assert.equal(again.status, 403); assert.equal(again.json.status, "invite");
      assert.equal(await usersWithEmail(second), 0);
      return `202 pending_confirmation, users=1, confirmation mail delivered, link consumed=${consumed}, login claimed=${logins}, second use=${again.status}, users(second)=0`;
    });

    // ---------------- S2 ----------------
    await check("S2", "password recovery: student -> mail; staff -> no mail; unknown -> no mail; all >= 1500 ms; bodies identical", async () => {
      const unknownEmail = `nobody-${randomUUID()}@mobile.local.test`;
      const beforeStudent = await mailCount(pwd.email);
      const beforeStaff = await mailCount(staff.email);
      const a = await call("/api/portal/password-recovery", { body: { email: pwd.email } });
      const b = await call("/api/portal/password-recovery", { body: { email: staff.email } });
      const c = await call("/api/portal/password-recovery", { body: { email: unknownEmail } });
      for (const r of [a, b, c]) { assert.equal(r.status, 200); assert.deepEqual(r.json, { ok: true }); assert.ok(r.ms >= RECOVERY_MIN_MS - 20, `answered in ${r.ms} ms`); }
      assert.ok(await waitForMail(pwd.email, beforeStudent), "student recovery mail did not arrive");
      await delay(3000);
      assert.equal(await mailCount(staff.email), beforeStaff, "staff address received mail");
      assert.equal(await mailCount(unknownEmail), 0, "unknown address received mail");
      const bad = await call("/api/portal/password-recovery", { body: { email: "not-an-email" } });
      const extra = await call("/api/portal/password-recovery", { body: { email: pwd.email, x: 1 } });
      assert.equal(bad.status, 400); assert.equal(extra.status, 400);
      return `student=${a.status}/${a.ms}ms mail=yes, staff=${b.status}/${b.ms}ms mail=no, unknown=${c.status}/${c.ms}ms mail=no, bad email=${bad.status}, extra key=${extra.status}`;
    });

    // ---------------- S3 ----------------
    const tokensA = [];
    await check("S3.1", "session by e-mail and by имя.фамилия login -> 200, token works against PostgREST as student", async () => {
      const byEmail = await session(main.email, main.password);
      const byLogin = await session(main.login, main.password);
      for (const r of [byEmail, byLogin]) {
        assert.equal(r.status, 200);
        assert.deepEqual(Object.keys(r.json).sort(), ["access_token", "expires_at", "expires_in", "refresh_token", "token_type"]);
        assert.equal(r.headers.get("set-cookie"), null);
        const authority = await authorityOf(r.json.access_token);
        assert.equal(authority.role, "student", `authority ${authority.role} ${authority.error?.message ?? ""}`);
      }
      tokensA.push(byEmail.json, byLogin.json);
      return `email=200 login=200 (${main.login ? "login form used" : ""}) authority=student, no cookie, no must_set_password`;
    });
    await check("S3.2", "wrong password and unknown login -> identical 401 bodies, >= 1000 ms", async () => {
      const wrong = await session(main.login, "definitely-wrong-password");
      const wrongEmail = await session(main.email, "definitely-wrong-password");
      const unknown = await session("nobody.nowhere", "definitely-wrong-password");
      for (const r of [wrong, wrongEmail, unknown]) { assert.equal(r.status, 401); assert.ok(r.ms >= SESSION_FAILURE_MIN_MS - 20, `${r.ms} ms`); }
      assert.equal(wrong.text, unknown.text); assert.equal(wrong.text, wrongEmail.text);
      return `401 x3, identical body ${wrong.text}, ms=${wrong.ms}/${wrongEmail.ms}/${unknown.ms}`;
    });
    await check("S3.3", "staff -> 401 like a wrong password, staff session revoked", async () => {
      const [{ id: staffUserId }] = await sql`SELECT id FROM auth.users WHERE lower(email)=${staff.email.toLowerCase()}`;
      const before = await sessionsOf(staffUserId);
      const r = await session(staff.email, staff.password);
      const wrong = await session(staff.email, "definitely-wrong-password");
      assert.equal(r.status, 401);
      assert.equal(r.text, wrong.text);
      assert.ok(r.ms >= SESSION_FAILURE_MIN_MS - 20);
      assert.equal(await sessionsOf(staffUserId), before, "the staff session created by the sign-in must be gone");
      const [{ n: logins }] = await sql`SELECT count(*)::int AS n FROM auth.audit_log_entries WHERE payload->>'actor_id'=${staffUserId} AND payload->>'action'='login'`;
      return `staff=401 same body as wrong password (${r.ms} ms), auth.sessions before=${before} after=${before}, audit login events seen=${logins}`;
    });
    await check("S3.4", "staff with a NON-active membership row is refused too", async () => {
      const blockedEmail = `blocked-${randomUUID()}@mobile.local.test`;
      const blockedPassword = `${randomUUID()}Aa1!`;
      const created = await service.auth.admin.createUser({ email: blockedEmail, password: blockedPassword, email_confirm: true });
      assert.equal(created.error, null);
      const [bundle] = await sql`SELECT id FROM platform.role_bundle_versions WHERE role='curator' AND status='published' ORDER BY version DESC LIMIT 1`;
      const profileId = randomUUID();
      await sql`INSERT INTO platform.profiles(id,auth_user_id,display_name,status,access_version) VALUES (${profileId},${created.data.user.id},'Blocked staff','active',1)`;
      await sql`INSERT INTO platform.organization_memberships(id,organization_id,profile_id,status,"current_role",current_bundle_id) VALUES (${randomUUID()},${fixture.organizationId},${profileId},'inactive','curator',${bundle.id})`;
      const r = await session(blockedEmail, blockedPassword);
      const before = await sessionsOf(created.data.user.id);
      assert.equal(r.status, 401);
      assert.equal(before, 0);
      return `inactive staff membership -> ${r.status}, sessions left=${before}`;
    });
    await check("S3.5", "temporary-password student -> 200 with must_set_password: true", async () => {
      const r = await session(temp.login, temp.password);
      assert.equal(r.status, 200); assert.equal(r.json.must_set_password, true);
      return `200 must_set_password=${r.json.must_set_password}`;
    });
    await check("S3.6", "lockout abuse: foreign addresses cannot lock the victim out of their own address", async () => {
      const victim = other;
      for (let i = 0; i < 12; i += 1) await session(victim.email, "attacker-guess", { ip: `198.51.100.${i + 1}` });
      const ok = await session(victim.email, victim.password, { ip: "198.51.100.250" });
      assert.equal(ok.status, 200);
      for (let i = 0; i < 10; i += 1) await session(victim.email, "attacker-guess", { ip: "198.51.100.251" });
      const blocked = await session(victim.email, victim.password, { ip: "198.51.100.251" });
      assert.equal(blocked.status, 429);
      const sameViaLogin = await session(victim.login, victim.password, { ip: "198.51.100.251" });
      assert.equal(sameViaLogin.status, 429);
      return `12 foreign failures then victim from own address=${ok.status}; 10 failures from one address then correct password=${blocked.status}; same person via login form=${sameViaLogin.status}`;
    });
    await check("S3.7", "S3 ignores Origin, sets no cookie; chunked/oversize body -> 400", async () => {
      const r = await session(pwd.email, pwd.password, { headers: { origin: "https://evil.example", cookie: "sb-forged=1" } });
      assert.equal(r.status, 200); assert.equal(r.headers.get("set-cookie"), null);
      const big = await call("/api/portal/mobile/session", { rawBody: JSON.stringify({ login: "a.b", password: "x".repeat(9000) }) });
      assert.equal(big.status, 400);
      const chunkedBody = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(`{"login":"a.b","password":"${"x".repeat(9000)}"}`)); c.close(); } });
      const chunked = await fetch(`${origin}/api/portal/mobile/session`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": nextIp() }, body: chunkedBody, duplex: "half" });
      assert.equal(chunked.status, 400);
      return `foreign Origin+Cookie=200 no set-cookie, 9 KB body=${big.status}, 9 KB chunked (no Content-Length)=${chunked.status}`;
    });

    // ---------------- S4 ----------------
    await check("S4.1", "change password from session A: B revoked, A alive, old fails, new works", async () => {
      const a = (await session(pwd.email, pwd.password)).json;
      const b = (await session(pwd.email, pwd.password)).json;
      assert.ok(a?.access_token && b?.access_token);
      const next = `${randomUUID()}Bb2!`;
      const changed = await passwordChange(a.access_token, { password: next, current_password: pwd.password });
      assert.equal(changed.status, 200, `${changed.status} ${changed.text}`);
      assert.deepEqual(changed.json, { ok: true });
      const bRefresh = await refresh(b.refresh_token);
      assert.equal(bRefresh.ok, false, "session B refresh token must fail");
      const aRefresh = await refresh(a.refresh_token);
      assert.equal(aRefresh.ok, true, "session A refresh token must work");
      assert.equal((await authorityOf(a.access_token)).role, "student");
      const old = await session(pwd.email, pwd.password);
      assert.equal(old.status, 401);
      const fresh = await session(pwd.email, next);
      assert.equal(fresh.status, 200);
      pwd.password = next;
      return `change=200, B refresh=rejected, A refresh=ok, A token authority=student, old password=${old.status}, new password=${fresh.status}`;
    });
    await check("S4.2", "weak password -> 400 weak_password; wrong/missing current; no bearer; staff bearer", async () => {
      const a = (await session(pwd.email, pwd.password)).json;
      const weak = await passwordChange(a.access_token, { password: "short", current_password: pwd.password });
      assert.equal(weak.status, 400); assert.equal(weak.json.error, "weak_password");
      const wrongCurrent = await passwordChange(a.access_token, { password: `${randomUUID()}Cc3!`, current_password: "wrong-current-password" });
      assert.equal(wrongCurrent.status, 403); assert.equal(wrongCurrent.json.error, "invalid_current_password");
      const missing = await passwordChange(a.access_token, { password: `${randomUUID()}Cc3!` });
      assert.equal(missing.status, 400);
      const noBearer = await call("/api/portal/mobile/password", { body: { password: `${randomUUID()}Cc3!`, current_password: pwd.password } });
      assert.equal(noBearer.status, 401);
      const staffToken = (await anon().auth.signInWithPassword(staffSessionLogin)).data.session.access_token;
      const staffTry = await passwordChange(staffToken, { password: `${randomUUID()}Cc3!`, current_password: staff.password });
      assert.equal(staffTry.status, 403); assert.equal(staffTry.json.error, "staff_account");
      return `weak=${weak.status}/${weak.json.error}, wrong current=${wrongCurrent.status}, missing current=${missing.status}, no bearer=${noBearer.status}, staff bearer=${staffTry.status}/${staffTry.json.error}`;
    });
    await check("S4.3", "temporary-password student sets own password without current_password; flag cleared", async () => {
      const s = (await session(temp.email, temp.password)).json;
      assert.equal(s.must_set_password, true);
      const next = `${randomUUID()}Dd4!`;
      const r = await passwordChange(s.access_token, { password: next });
      assert.equal(r.status, 200, `${r.status} ${r.text}`);
      const user = await service.auth.admin.getUserById(temp.authUserId);
      assert.notEqual(user.data.user.app_metadata.evo_temporary_password, true);
      const again = await session(temp.email, next);
      assert.equal(again.status, 200); assert.equal(again.json.must_set_password, undefined);
      return `set=200, flag now ${String(user.data.user.app_metadata.evo_temporary_password)}, re-login=200 without must_set_password`;
    });

    // ---------------- S5 ----------------
    const bearerOf = async () => (await session(main.email, main.password)).json.access_token;
    const download = (token, kind, id) => call(`/api/portal/case-files/${kind}/${id}/download`, { method: "GET", headers: token ? { authorization: `Bearer ${token}` } : {} });
    await check("S5.1", "own contract with bearer -> 307 to a signed URL that returns the exact bytes", async () => {
      const token = await bearerOf();
      const r = await download(token, "contract", main.file.id);
      assert.equal(r.status, 307, `${r.status} ${r.text.slice(0, 120)}`);
      const location = r.headers.get("location");
      assert.ok(location?.startsWith(apiUrl), "signed URL must point at the local Storage");
      const bytes = Buffer.from(await (await fetch(location)).arrayBuffer());
      assert.ok(bytes.equals(main.file.bytes), "downloaded bytes differ");
      return `307 -> signed URL (${new URL(location).pathname.split("/").slice(0, 5).join("/")}/...), ${bytes.byteLength} bytes identical`;
    });
    await check("S5.2", "no bearer / garbage bearer -> 401 unauthorized; foreign and random id -> 403; wrong kind -> 400; staff bearer refused", async () => {
      const none = await download(null, "contract", main.file.id);
      const garbage = await download("garbage", "contract", main.file.id);
      const malformed = await call(`/api/portal/case-files/contract/${main.file.id}/download`, { method: "GET", headers: { authorization: "Bearer not.a.jwt" } });
      assert.equal(none.status, 401); assert.equal(garbage.status, 401); assert.equal(malformed.status, 401);
      assert.deepEqual(garbage.json, { error: "unauthorized" });
      const token = await bearerOf();
      const foreign = await download(token, "contract", other.file.id);
      const random = await download(token, "contract", randomUUID());
      const kind = await download(token, "passport", main.file.id);
      assert.equal(foreign.status, 403); assert.equal(random.status, 403); assert.ok([400, 403].includes(kind.status));
      const staffToken = (await anon().auth.signInWithPassword(staffSessionLogin)).data.session.access_token;
      const staffTry = await download(staffToken, "contract", main.file.id);
      assert.ok([401, 403].includes(staffTry.status), `staff ${staffTry.status}`);
      return `no bearer=${none.status}, garbage=${garbage.status}/${garbage.text}, foreign student's file=${foreign.status}, random id=${random.status}, unknown kind=passport ${kind.status}, staff bearer=${staffTry.status}`;
    });
  } finally {
    await sql.end();
  }
  return results;
}
