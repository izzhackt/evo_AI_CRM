import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { normalizeStudentLogin, studentLoginBase } from "../src/lib/student-login.ts";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

// 07.11.2026: логин студента — имя.фамилия латиницей, как в загранпаспорте; студент его не выбирает.
test("the login base is name.surname in passport Latin", () => {
  assert.equal(studentLoginBase("Айдай", "Чынарова"), "aidai.chynarova");
  assert.equal(studentLoginBase("Aidai", "Chynarova"), "aidai.chynarova", "Latin stays as typed, in lower case");
  assert.equal(studentLoginBase("Айжан", "Асанова"), "aizhan.asanova");
  assert.equal(studentLoginBase("Юлия", "Щукина"), "iuliia.shchukina", "ICAO 9303: ю iu, я ia, щ shch");
  assert.equal(studentLoginBase("Нурбек", "Мөңкүбаев"), "nurbek.mongkubaev", "Kyrgyz ң, ө, ү");
  assert.equal(studentLoginBase("Анна-Мария", "О'Нил"), "annamariia.onil", "hyphens and apostrophes drop");
  assert.equal(studentLoginBase("", ""), "student.student", "an empty part becomes «student»");
  assert.equal(studentLoginBase("7up", "Test"), "s7up.test", "a login starts with a letter");
  assert.ok(studentLoginBase("Ааааааааааааааааааааааааааааааааа", "Б").split(".")[0].length <= 24, "parts are bounded");
});

test("the login field accepts a student login in any case, never an email or the admin alias", () => {
  assert.equal(normalizeStudentLogin(" QA.Student "), "qa.student");
  assert.equal(normalizeStudentLogin("aidai.chynarova2"), "aidai.chynarova2");
  assert.equal(normalizeStudentLogin("someone@example.invalid"), null);
  assert.equal(normalizeStudentLogin("admin"), null, "a login always has a dot");
  assert.equal(normalizeStudentLogin("ab"), null);
});

test("sign-in resolves a login on the server only and answers like a wrong password", () => {
  const action = source("src/lib/staff-auth-actions.ts");
  assert.match(action, /if \(!usesAdminAlias && !login\.includes\("@"\)\) \{\n\s+const resolved = await resolveStudentLoginEmail\(login\);/u);
  assert.match(action, /if \(resolved\.status === "unavailable"\) return "authUnavailable";/u);
  assert.match(action, /email = resolved\.status === "found" \? resolved\.email : "";/u);
  const server = source("src/lib/server/student-login.ts");
  assert.match(server, /^import "server-only";/u);
  assert.match(server, /createPlatformSupabaseServiceClient\(getPlatformSupabaseBackendConfig\(\)\)/u);
  assert.match(server, /\.rpc\("student_login_email_v1", \{ p_login: login \}\)/u);
  const own = source("src/lib/portal/student-login-source.ts");
  assert.match(own, /\.rpc\("own_student_login_v1"\)/u);
});
