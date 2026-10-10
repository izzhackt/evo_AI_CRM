import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  decodeStudentInviteCallbackQuery,
  decodeStudentRecoveryCallbackQuery,
  isExpectedStudentOriginRequest,
  validateStudentInviteCallbackPost,
  validateStudentRecoveryCallbackPost,
} from "../src/lib/student-invite-callback-contract.ts";
import {
  checkStudentNewPassword,
  classifyStudentRecoveryRequestError,
  hasStaffRecoveryMarker,
  normalizeStudentRecoveryEmail,
  STUDENT_PASSWORD_FORGOT_PATH,
  STUDENT_PASSWORD_RESET_PATH,
  STUDENT_RECOVERY_ADDRESS_LIMIT,
  STUDENT_RECOVERY_IP_LIMIT,
  STUDENT_RECOVERY_MIN_RESPONSE_MS,
  STUDENT_RECOVERY_SESSION_COOKIE,
} from "../src/lib/student-password-recovery-contract.ts";
import {
  createRecoveryRateLimiter,
  recoveryClientIpKey,
} from "../src/lib/student-password-recovery-rate-limit.ts";
import { getPasswordRecoveryStrings } from "../src/lib/portal/password-recovery-i18n.ts";
import {
  canonicalPlatformPageOrigin,
  PRODUCTION_STUDENT_ORIGIN,
} from "../src/lib/platform-public-origin.ts";
import {
  isConnectedPlatformPage,
  isConnectedStudentAuthPage,
  isConnectedStudentPortalPage,
} from "../src/lib/platform-route-contract.ts";

const HASH = "0123456789abcdef".repeat(3) + "01234567";
const CSRF = "76f045de-e194-4ff2-9852-969fadf615b5";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function post(overrides = {}) {
  return {
    nodeEnv: "development",
    localCallbackOrigin: "http://127.0.0.1:3121",
    origin: "http://127.0.0.1:3121",
    host: "127.0.0.1:3121",
    forwardedHost: null,
    forwardedProto: null,
    csrfCookie: CSRF,
    form: new Map([["csrf_token", CSRF], ["token_hash", HASH], ["type", "recovery"]]),
    ...overrides,
  };
}

test("recovery link is exactly the Recovery template shape, plain or PKCE hash", () => {
  assert.equal(HASH.length, 56);
  assert.deepEqual(decodeStudentRecoveryCallbackQuery({ token_hash: HASH, type: "recovery" }),
    { tokenHash: HASH, type: "recovery" });
  assert.deepEqual(decodeStudentRecoveryCallbackQuery({ token_hash: `pkce_${HASH}`, type: "recovery" }),
    { tokenHash: `pkce_${HASH}`, type: "recovery" });
  for (const query of [
    {},
    { token_hash: HASH },
    { token_hash: HASH, type: "invite" },
    { token_hash: HASH, type: "magiclink" },
    { token_hash: HASH.toUpperCase(), type: "recovery" },
    { token_hash: HASH.slice(1), type: "recovery" },
    { token_hash: `PKCE_${HASH}`, type: "recovery" },
    { token_hash: `pkce_pkce_${HASH}`, type: "recovery" },
    { token_hash: [HASH], type: "recovery" },
    { token_hash: HASH, type: ["recovery"] },
    { token_hash: HASH, type: "recovery", next: "https://evil.example" },
    { token_hash: HASH, type: "recovery", redirect_to: "/portal" },
  ]) {
    assert.equal(decodeStudentRecoveryCallbackQuery(query), null, JSON.stringify(query));
  }
  // The invite path keeps its own exact contract.
  assert.equal(decodeStudentInviteCallbackQuery({ token_hash: HASH, type: "recovery" }), null);
  assert.equal(decodeStudentInviteCallbackQuery({ token_hash: `pkce_${HASH}`, type: "invite" }), null);
});

test("recovery POST needs the Student origin, effective host, CSRF pair and exact form", () => {
  assert.deepEqual(validateStudentRecoveryCallbackPost(post()), { tokenHash: HASH, type: "recovery" });
  const pkce = post({ form: new Map([["csrf_token", CSRF], ["token_hash", `pkce_${HASH}`], ["type", "recovery"]]) });
  assert.deepEqual(validateStudentRecoveryCallbackPost(pkce), { tokenHash: `pkce_${HASH}`, type: "recovery" });
  for (const bad of [
    post({ origin: "http://127.0.0.1:3000" }),
    post({ origin: "https://evil.example" }),
    post({ origin: null }),
    post({ host: "127.0.0.1:3000" }),
    post({ forwardedHost: "evil.example", forwardedProto: "http" }),
    post({ forwardedHost: "127.0.0.1:3121", forwardedProto: null }),
    post({ csrfCookie: null }),
    post({ csrfCookie: "76f045de-e194-4ff2-9852-969fadf615b6" }),
    post({ form: new Map([["csrf_token", CSRF], ["token_hash", HASH], ["type", "invite"]]) }),
    post({ form: new Map([["csrf_token", CSRF], ["token_hash", HASH]]) }),
    post({ form: new Map([["csrf_token", CSRF], ["token_hash", HASH], ["type", "recovery"], ["next", "/"]]) }),
  ]) {
    assert.equal(validateStudentRecoveryCallbackPost(bad), null);
  }
  // A recovery form can never drive the invite verifier, and vice versa.
  assert.equal(validateStudentInviteCallbackPost(post()), null);
  assert.equal(validateStudentRecoveryCallbackPost(post({
    form: new Map([["csrf_token", CSRF], ["token_hash", HASH], ["type", "invite"]]),
  })), null);
  // Production ignores any local origin override.
  assert.equal(isExpectedStudentOriginRequest({
    nodeEnv: "production", localCallbackOrigin: "http://127.0.0.1:3121",
    origin: "http://127.0.0.1:3121", host: "127.0.0.1:3121", forwardedHost: null, forwardedProto: null,
  }), false);
  assert.equal(isExpectedStudentOriginRequest({
    nodeEnv: "production", origin: PRODUCTION_STUDENT_ORIGIN, host: "evo-crm-app:3000",
    forwardedHost: "app.evoadmissions.com", forwardedProto: "https",
  }), true);
  assert.equal(isExpectedStudentOriginRequest({
    nodeEnv: "production", origin: "https://crm.evoadmissions.com", host: "evo-crm-app:3000",
    forwardedHost: "crm.evoadmissions.com", forwardedProto: "https",
  }), false);
});

test("email normalization and the shared Student password bounds", () => {
  assert.equal(normalizeStudentRecoveryEmail("  Student@Example.COM "), "student@example.com");
  for (const bad of ["", "a@b", "no-at.example.com", "a@@b.co", "a b@c.co", "a@b.co\u0000", 42, null,
    `${"a".repeat(250)}@b.co`]) {
    assert.equal(normalizeStudentRecoveryEmail(bad), null, String(bad));
  }
  assert.equal(checkStudentNewPassword("short", "short"), "too_short");
  assert.equal(checkStudentNewPassword("a".repeat(12), "a".repeat(12)), "ok");
  assert.equal(checkStudentNewPassword("a".repeat(12), "b".repeat(12)), "mismatch");
  assert.equal(checkStudentNewPassword("я".repeat(36), "я".repeat(36)), "ok");
  assert.equal(checkStudentNewPassword("я".repeat(37), "я".repeat(37)), "too_long");
  assert.equal(checkStudentNewPassword("a".repeat(73), "a".repeat(73)), "too_long");
});

test("request answers stay neutral; only the per-IP Auth limit asks to retry", () => {
  assert.equal(classifyStudentRecoveryRequestError(null), "sent");
  // The project email cap and SMTP failures are reached only for a real
  // account, whatever the message says.
  assert.equal(classifyStudentRecoveryRequestError({ status: 429, code: "over_email_send_rate_limit",
    message: "For security purposes, you can only request this after 37 seconds." }), "sent");
  assert.equal(classifyStudentRecoveryRequestError({ status: 429, code: "over_email_send_rate_limit",
    message: "email rate limit exceeded" }), "sent");
  assert.equal(classifyStudentRecoveryRequestError({ code: "over_email_send_rate_limit" }), "sent");
  assert.equal(classifyStudentRecoveryRequestError({ status: 429 }), "sent");
  assert.equal(classifyStudentRecoveryRequestError({ status: 500, code: "unexpected_failure",
    message: "Error sending recovery email" }), "sent");
  assert.equal(classifyStudentRecoveryRequestError({ name: "AuthRetryableFetchError", status: 504 }), "sent");
  assert.equal(classifyStudentRecoveryRequestError({ status: 400, code: "user_banned" }), "sent");
  assert.equal(classifyStudentRecoveryRequestError({ status: 429, code: "over_request_rate_limit",
    message: "Request rate limit reached" }), "rate_limited");
  assert.equal(classifyStudentRecoveryRequestError({ status: 400, code: "validation_failed" }), "invalid_email");
  // No HTTP answer at all.
  assert.equal(classifyStudentRecoveryRequestError({ name: "AuthRetryableFetchError", status: 0 }), "unavailable");
  assert.equal(classifyStudentRecoveryRequestError({ name: "AuthRetryableFetchError" }), "unavailable");
  assert.equal(classifyStudentRecoveryRequestError(new Error("network")), "unavailable");
  assert.ok(STUDENT_RECOVERY_MIN_RESPONSE_MS >= 1_500);
});

test("the sent text does not promise a send; link validity matches the consume step", () => {
  for (const locale of ["ru", "ky", "en"]) {
    const strings = getPasswordRecoveryStrings(locale);
    assert.doesNotMatch(strings.sent, /отправили|жөнөттүк/u, locale);
    assert.doesNotMatch(strings.sentValidity, /открывается|ачылат/u, locale);
  }
  assert.equal(getPasswordRecoveryStrings("ru").sentValidity, "Ссылкой можно воспользоваться один раз в течение часа.");
  assert.equal(getPasswordRecoveryStrings("ky").sentValidity, "Шилтемени бир саат ичинде бир гана жолу колдонсо болот.");
  assert.match(source("supabase/templates/recovery.html"), /Ссылкой можно воспользоваться один раз в течение часа\./u);
});

test("form limiter: sliding window per key, bounded keys", () => {
  const limiter = createRecoveryRateLimiter(3);
  const rule = { limit: 2, windowMs: 1_000 };
  assert.equal(limiter.consume("a", rule, 0), true);
  assert.equal(limiter.consume("a", rule, 10), true);
  assert.equal(limiter.consume("a", rule, 20), false);
  assert.equal(limiter.consume("a", rule, 999), false);
  assert.equal(limiter.consume("a", rule, 1_000), true);
  assert.equal(limiter.consume("b", rule, 1_000), true);
  assert.equal(limiter.consume("c", rule, 1_000), true);
  assert.equal(limiter.consume("d", rule, 1_000), true);
  assert.ok(limiter.size() <= 3);
  // The documented production limits.
  assert.deepEqual({ ...STUDENT_RECOVERY_IP_LIMIT }, { limit: 5, windowMs: 15 * 60_000 });
  assert.deepEqual({ ...STUDENT_RECOVERY_ADDRESS_LIMIT }, { limit: 3, windowMs: 60 * 60_000 });
});

test("form limiter keys the address the edge proxy added", () => {
  assert.equal(recoveryClientIpKey("203.0.113.7"), "ip4:203.0.113.7");
  // A client-supplied first element never chooses the bucket.
  assert.equal(recoveryClientIpKey("198.51.100.1, 203.0.113.7"), "ip4:203.0.113.7");
  assert.equal(recoveryClientIpKey("::ffff:127.0.0.1"), "ip4:127.0.0.1");
  assert.equal(recoveryClientIpKey("2001:db8:abcd:12:1:2:3:4"), "ip6:2001:db8:abcd:12::/64");
  assert.equal(recoveryClientIpKey("2001:db8:abcd:12::99"), "ip6:2001:db8:abcd:12::/64");
  assert.equal(recoveryClientIpKey("::1"), "ip6:0:0:0:0::/64");
  for (const bad of [null, undefined, "", "unknown", "999.1.1.1", "1.2.3", "1::2::3", "evil.example"]) {
    assert.equal(recoveryClientIpKey(bad), "ip:unknown", String(bad));
  }
});

test("staff markers and a non-Student role claim refuse the Student flow", () => {
  const plain = { app_metadata: { provider: "email" }, user_metadata: {} };
  assert.equal(hasStaffRecoveryMarker(plain, { platform_role: "student" }), false);
  assert.equal(hasStaffRecoveryMarker(plain, {}), false);
  assert.equal(hasStaffRecoveryMarker({ app_metadata: { evo_staff_password_request_id: "" } }, {}), false);
  assert.equal(hasStaffRecoveryMarker({ app_metadata: { evo_staff_password_request_id: "r1" } }, {}), true);
  assert.equal(hasStaffRecoveryMarker({ user_metadata: { evo_staff_invitation_request_id: "r2" } }, {}), true);
  for (const role of ["admin", "sales", "curator", "finance", "staff"]) {
    assert.equal(hasStaffRecoveryMarker(plain, { platform_role: role }), true, role);
  }
});

test("recovery pages are exact Student auth pages on the Student origin", () => {
  for (const path of [STUDENT_PASSWORD_FORGOT_PATH, STUDENT_PASSWORD_RESET_PATH]) {
    assert.equal(isConnectedStudentAuthPage(path), true, path);
    assert.equal(isConnectedStudentPortalPage(path), false, path);
    assert.equal(isConnectedPlatformPage(path), true, path);
    assert.equal(canonicalPlatformPageOrigin("crm.evoadmissions.com", path), PRODUCTION_STUDENT_ORIGIN, path);
    assert.equal(canonicalPlatformPageOrigin("app.evoadmissions.com", path), null, path);
    assert.equal(isConnectedStudentAuthPage(`${path}/`), false, path);
    assert.equal(isConnectedStudentAuthPage(`${path}/child`), false, path);
  }
});

test("proxy passes recovery pages without reading or refreshing the product session", () => {
  const proxy = source("src/proxy.ts");
  const branch = proxy.indexOf("path === STUDENT_PASSWORD_FORGOT_PATH || path === STUDENT_PASSWORD_RESET_PATH");
  const canonical = proxy.indexOf("canonicalPlatformPageOrigin(request.headers.get(\"host\"), path)");
  const authority = proxy.indexOf("const session = await liveSessionState(request, requestHeaders);");
  assert.ok(branch > canonical, "crm host must still relocate recovery pages to the Student origin");
  assert.ok(branch < authority, "recovery pages must not depend on the product session");
  const block = proxy.slice(branch, proxy.indexOf('if (path === "/auth/callback")'));
  assert.doesNotMatch(block, /liveSessionState|createServerClient/u);
  assert.match(block, /Referrer-Policy", "no-referrer"/u);
});

test("server flow: fixed redirect, explicit verify, path-scoped recovery session", () => {
  const actions = source("src/lib/student-password-recovery-actions.ts");
  const server = source("src/lib/server/student-password-recovery.ts");
  const callback = source("src/app/auth/callback/page.tsx");
  const resetPage = source("src/app/auth/reset-password/page.tsx");
  const login = source("src/app/login/page.tsx");

  // redirectTo only from the frozen Student callback URL, never request input.
  assert.match(actions, /redirectTo = studentInviteCallbackUrl\(\s*process\.env\.NODE_ENV,\s*process\.env\.EVO_STUDENT_INVITE_LOCAL_ORIGIN,?\s*\)/u);
  assert.doesNotMatch(actions, /fields\.get\("redirect|form\.get\("redirect|next=/u);
  assert.match(actions, /exactActionStringFields\(form, \["email"\]\)/u);
  assert.match(actions, /exactActionStringFields\(form, \["csrf_token", "token_hash", "type"\]\)/u);
  assert.match(actions, /exactActionStringFields\(form, \["password", "password_confirm"\]\)/u);
  assert.match(actions, /validateStudentRecoveryCallbackPost/u);
  assert.equal((actions.match(/studentOriginRequest\(\)\)/gu) ?? []).length, 2);
  // Own limit first, then the staff lookup, then Auth; one minimum answer time.
  assert.match(actions, /admitStudentRecoveryRequest\(forwardedFor, email\)/u);
  assert.match(actions, /get\("x-forwarded-for"\)/u);
  assert.match(actions, /admission === "address_limited"\) return "sent"/u);
  assert.match(actions, /STUDENT_RECOVERY_MIN_RESPONSE_MS/u);
  const lookup = server.indexOf("const recipient = await classifyRecoveryRecipient(email);");
  const reset = server.indexOf("resetPasswordForEmail(email");
  assert.ok(lookup > 0 && reset > lookup, "staff lookup must run before Auth");
  assert.match(server, /if \(recipient === "staff"\) \{[^}]*return "sent";/u);
  assert.match(server, /findRawAuthUserByExactEmail\(service, normalizedEmail\)/u);
  assert.match(server, /createHash\("sha256"\)\.update\(normalizedEmail\)/u);

  assert.match(server, /verifyOtp\(\{\s*token_hash: tokenHash,\s*type: "recovery",?\s*\}\)/u);
  assert.match(server, /flowType: "implicit"/u);
  assert.match(server, /cookieOptions: \{ name: STUDENT_RECOVERY_SESSION_COOKIE \}/u);
  assert.match(server, /path: STUDENT_PASSWORD_RESET_PATH,\s*httpOnly: true,\s*sameSite: "strict"/u);
  assert.match(server, /readVerifiedPlatformAuthority/u);
  assert.match(server, /hasStaffRecoveryMarker/u);
  // The recovery session is ended before the ordinary sign-in.
  const revoke = server.indexOf('await revokeSession(client, "complete_revoke")');
  const signIn = server.indexOf("signInWithPassword");
  assert.ok(revoke > 0 && signIn > revoke);
  assert.equal(STUDENT_RECOVERY_SESSION_COOKIE.startsWith("sb-"), false);

  assert.doesNotMatch(callback, /verifyOtp|exchangeCodeForSession|signIn/u);
  assert.match(callback, /decodeStudentRecoveryCallbackQuery/u);
  assert.doesNotMatch(resetPage, /createSupabaseServerClient|verifyOtp/u);
  assert.match(login, /recovery=\{audience === "staff" \? undefined/u);
});
