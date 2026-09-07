import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("callback GET renders only an explicit CSRF-bound confirmation form", () => {
  const page = source("src/app/auth/callback/page.tsx");
  const component = source("src/components/StudentInviteCallback.tsx");

  assert.match(page, /decodeStudentInviteCallbackQuery/u);
  assert.match(page, /STUDENT_INVITE_CSRF_COOKIE/u);
  assert.match(page, /<StudentInviteCallback/u);
  assert.doesNotMatch(page, /verifyOtp|exchangeCodeForSession|signIn/u);

  assert.match(component, /useActionState\(\s*verifyStudentInviteAction/u);
  assert.match(component, /name="csrf_token"/u);
  assert.match(component, /name="token_hash"/u);
  assert.match(component, /name="type" value="invite"/u);
  assert.match(component, /type="submit"/u);
  assert.doesNotMatch(component, /createBrowserClient|verifyOtp/u);
});

test("only the callback POST action invokes the server verification core", () => {
  const action = source("src/lib/student-portal-auth-actions.ts");
  const runtime = source("src/lib/server/student-invite-callback-runtime.ts");
  const proxy = source("src/proxy.ts");

  assert.match(action, /validateStudentInviteCallbackPost/u);
  assert.match(action, /verifyStudentInviteCallback/u);
  assert.match(runtime, /verifyOtp\(\{\s*token_hash: input\.tokenHash,\s*type: "invite"/u);
  assert.doesNotMatch(proxy, /verifyOtp|exchangeCodeForSession/u);
  assert.doesNotMatch(`${action}\n${runtime}\n${proxy}`, /[?&](?:code|next)=/u);
});

test("proxy handles callback CSRF before product authority dispatch", () => {
  const proxy = source("src/proxy.ts");
  const callbackBranch = proxy.indexOf('path === "/auth/callback"');
  const authorityRead = proxy.indexOf("liveSessionState(request");

  assert.ok(callbackBranch >= 0, "callback branch must exist");
  assert.ok(authorityRead >= 0, "live session authority read must exist");
  assert.ok(
    callbackBranch < authorityRead,
    "callback GET must not depend on staff or Student authority",
  );
  assert.match(proxy, /httpOnly: true/u);
  assert.match(proxy, /sameSite: "strict"/u);
  assert.match(proxy, /Cache-Control", "no-store"/u);
});
