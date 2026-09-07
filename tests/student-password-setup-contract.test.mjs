import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("password setup is an auth-only receipt-bound action with no invite token", () => {
  const page = source("src/app/auth/set-password/page.tsx");
  const component = source("src/components/StudentSetPasswordForm.tsx");
  const actions = source("src/lib/student-portal-auth-actions.ts");
  const passwordAction = actions.slice(
    actions.indexOf("export async function setStudentPortalPasswordAction"),
    actions.indexOf("export async function refreshStudentPortalAccessAction"),
  );

  assert.match(page, /readVerifiedStudentInviteSession/u);
  assert.match(component, /useActionState\(\s*setStudentPortalPasswordAction/u);
  assert.match(component, /autoComplete="new-password"/u);
  assert.match(component, /name="password_confirm"/u);
  assert.match(passwordAction, /exactActionStringFields\(form, \["password", "password_confirm"\]\)/u);
  assert.match(passwordAction, /auth\.updateUser\(\{ password \}\)/u);
  assert.match(passwordAction, /readVerifiedStudentPortalAuthority/u);
  assert.doesNotMatch(`${page}\n${component}\n${passwordAction}`, /token_hash|verifyOtp/u);
});

test("pending surface exposes only bounded refresh and local sign-out", () => {
  const page = source("src/app/auth/account-pending/page.tsx");
  const component = source("src/components/StudentAccountPending.tsx");

  assert.match(page, /readVerifiedStudentInviteSession/u);
  assert.match(page, /accountPending/u);
  assert.match(component, /refreshStudentPortalAccessAction/u);
  assert.match(component, /logoutStudentPortalAction/u);
  assert.doesNotMatch(`${page}\n${component}`, /studentCase|documents|payments|applications/u);
});

test("root, login and proxy dispatch each authenticated identity to one product", () => {
  const root = source("src/app/page.tsx");
  const login = source("src/lib/staff-auth-actions.ts");
  const proxy = source("src/proxy.ts");

  assert.match(root, /resolvePlatformActor/u);
  assert.match(root, /resolveStudentPortalActor/u);
  assert.match(root, /readVerifiedStudentInviteSession/u);
  assert.match(root, /return "\/portal"/u);
  assert.match(root, /return "\/auth\/account-pending"/u);

  assert.match(login, /readVerifiedStudentPortalAuthority/u);
  assert.match(login, /readVerifiedStudentInviteSession/u);
  assert.match(login, /redirectTarget = "\/portal"/u);
  assert.match(login, /redirectTarget = "\/auth\/account-pending"/u);

  assert.match(proxy, /session\.state === "student"/u);
  assert.match(proxy, /"\/auth\/account-pending"/u);
});
