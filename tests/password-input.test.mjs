import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const ROOT = new URL("..", import.meta.url).pathname;
const read = (path) => readFileSync(join(ROOT, path), "utf8");

function sources(dir) {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const path = `${dir}/${name}`;
    return statSync(join(ROOT, path)).isDirectory() ? sources(path) : /\.tsx$/u.test(name) ? [path] : [];
  });
}

test("every password field on the web is the one shared PasswordInput (the eye)", () => {
  const raw = sources("src").filter((path) => path !== "src/components/PasswordInput.tsx" && /type=(?:"|\{["'])password/u.test(read(path)));
  assert.deepEqual(raw, [], "a raw type=password input has no show/hide button");
  const users = ["src/components/AuthForms.tsx", "src/components/StaffAccountAccess.tsx", "src/components/StudentSetPasswordForm.tsx",
    "src/components/portal/profile/PasswordChangeForm.tsx", "src/components/student-recovery/StudentResetPasswordForm.tsx",
    "src/components/student-application/NewPasswordForm.tsx"];
  for (const path of users) assert.match(read(path), /<PasswordInput\b/u, path);
});

test("PasswordInput: a real button that never submits, pressed state, RU/KY labels, same input node with only the type changed", () => {
  const source = read("src/components/PasswordInput.tsx");
  assert.match(source, /type="button"/u);
  assert.match(source, /aria-pressed=\{visible\}/u);
  assert.match(source, /type=\{visible \? "text" : "password"\}/u);
  assert.match(source, /Показать пароль/u);
  assert.match(source, /Скрыть пароль/u);
  assert.match(source, /Сырсөздү көрсөтүү/u);
  assert.match(source, /setSelectionRange/u, "the caret is put back after the type changes");
  assert.match(source, /onMouseDown=\{\(event\) => event\.preventDefault\(\)\}/u, "a pointer press keeps the field focused");
  assert.doesNotMatch(source, /autoComplete=/u, "autocomplete attributes stay the caller's");
  const css = read("src/app/globals.css");
  assert.match(css, /\.evo-pw-toggle \{[^}]*width: 44px;[^}]*height: 44px;/u);
});

test("the labels of the form fields name the field, not the eye: label is a sibling of the field wrapper", () => {
  for (const path of ["src/components/StaffAccountAccess.tsx", "src/components/portal/profile/PasswordChangeForm.tsx", "src/components/student-application/NewPasswordForm.tsx"]) {
    assert.doesNotMatch(read(path), /<label[^>]*>(?:(?!<\/label>)[\s\S])*<PasswordInput/u, `${path}: no PasswordInput inside a <label>`);
  }
});
