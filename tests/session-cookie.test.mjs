import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { SESSION_ONLY_COOKIE, sessionAwareCookieOptions } from "../src/lib/session-cookie.ts";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

// «Это моё устройство» (06.11.2026): без галочки cookie входа живут до закрытия браузера.
test("without the checkbox the sign-in cookies lose their lifetime, deletions stay deletions", () => {
  const options = { path: "/", sameSite: "lax", httpOnly: false, maxAge: 34_560_000, expires: new Date("2027-12-01T00:00:00Z") };
  assert.deepEqual(sessionAwareCookieOptions("token", options, false), options, "with the checkbox nothing changes");
  assert.deepEqual(sessionAwareCookieOptions("token", options, true), { path: "/", sameSite: "lax", httpOnly: false },
    "without it the cookie has no maxAge and no expires");
  const deletion = { path: "/", maxAge: 0 };
  assert.deepEqual(sessionAwareCookieOptions("", deletion, true), deletion, "sign-out still deletes the cookie");
  assert.deepEqual(sessionAwareCookieOptions("token", deletion, true), deletion, "maxAge 0 is a deletion");
});

test("the server client, the proxy and the login action all use the same switch", () => {
  assert.equal(SESSION_ONLY_COOKIE, "evo_session_only");
  const server = source("src/lib/supabase/server.ts");
  assert.match(server, /settings\.sessionOnly \?\? cookieStore\.get\(SESSION_ONLY_COOKIE\)\?\.value === "1"/u);
  assert.match(server, /cookieStore\.set\(name, value, sessionAwareCookieOptions\(value, options, sessionOnly\)\)/u);
  const proxy = source("src/proxy.ts");
  assert.match(proxy, /request\.cookies\.get\(SESSION_ONLY_COOKIE\)\?\.value === "1"/u);
  assert.match(proxy, /response\.cookies\.set\(name, value, sessionAwareCookieOptions\(value, options, sessionOnly\)\)/u);
  const action = source("src/lib/staff-auth-actions.ts");
  assert.match(action, /submittedValue\(form, "remember_device"\) === "1"/u);
  assert.match(action, /createSupabaseServerClient\(\{ sessionOnly: !rememberDevice \}\)/u);
  assert.match(action, /cookieStore\.delete\(SESSION_ONLY_COOKIE\)/u);
  assert.match(action, /\(await cookies\(\)\)\.delete\(SESSION_ONLY_COOKIE\)/u, "sign-out forgets the choice");
  const form = source("src/components/AuthForms.tsx");
  assert.match(form, /name="remember_device"\s+value="1"\s+defaultChecked/u, "the checkbox is on by default");
});
