import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { getPortalStrings } from "../src/lib/portal/i18n.ts";
import { STUDENT_PASSWORD_CHANGE_MESSAGE_KEY } from "../src/lib/student-password-change-contract.ts";

// «Профиль → Пароль» (06.11.2026): студент меняет пароль сам. Живая проверка — в браузере на локальном стенде.
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("every answer of the form has its words in Russian and Kyrgyz", () => {
  for (const locale of ["ru", "ky"]) {
    const strings = getPortalStrings("profile", locale);
    for (const key of Object.values(STUDENT_PASSWORD_CHANGE_MESSAGE_KEY)) {
      assert.equal(typeof strings[key], "string", `${locale}.${key}`);
      assert.ok(strings[key].length > 0, `${locale}.${key}`);
    }
    for (const key of ["passwordHeading", "passwordCurrent", "passwordNew", "passwordConfirm", "passwordHint", "passwordSubmit", "passwordSaving"]) {
      assert.ok(strings[key]?.length > 0, `${locale}.${key}`);
    }
  }
});

test("the action takes exactly three fields from the cabinet origin and the Student from the live session", () => {
  const action = read("src/lib/student-password-change-actions.ts");
  assert.match(action, /exactActionStringFields\(form, \["current_password", "password", "password_confirm"\]\)/u);
  assert.match(action, /if \(!fields \|\| !\(await studentOriginRequest\(\)\)\) return \{ status: "unavailable" \};/u);
  assert.match(action, /const actor = await requireStudentPortalActor\(\);/u);
  assert.match(action, /checkStudentNewPassword\(password, fields\.get\("password_confirm"\)!\)/u, "the recovery rule: 12 characters, 72 bytes");
  assert.match(action, /authUserId: actor\.authUserId, email: actor\.email/u, "never an address from the form");
});

test("the current password is checked by a real sign-in on an isolated client; only that session is closed", () => {
  const server = read("src/lib/server/student-password-change.ts");
  assert.match(server, /persistSession: false, autoRefreshToken: false, detectSessionInUrl: false/u);
  assert.match(server, /signInWithPassword\(\{ email: input\.email, password: input\.currentPassword \}\)/u);
  assert.match(server, /signIn\.data\.user\?\.id !== input\.authUserId/u, "the session belongs to this Student");
  assert.match(server, /updateUser\(\{ password: input\.newPassword \}\)/u);
  assert.doesNotMatch(server, /signOut\(\)/u, "a global sign-out would end the browser session too");
  assert.match(server, /signOut\(\{ scope: "local" \}\)/u);
  assert.match(server, /limiter\.consume\(`password-change:\$\{input\.authUserId\}`, RULE\)/u);
  assert.doesNotMatch(server, /console\.(log|info|warn|error)\([^)]*password/iu, "passwords are never logged");
});

test("the profile shows the password card before the account deletion card", () => {
  const page = read("src/app/(portal)/portal/profile/page.tsx");
  assert.ok(page.indexOf('aria-labelledby="portal-profile-password"') > 0);
  assert.ok(page.indexOf('aria-labelledby="portal-profile-password"') < page.indexOf('aria-labelledby="portal-profile-deletion"'));
  const form = read("src/components/portal/profile/PasswordChangeForm.tsx");
  assert.match(form, /autoComplete="current-password"/u);
  assert.equal((form.match(/autoComplete="new-password"/gu) ?? []).length, 2);
});
