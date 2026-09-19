import assert from "node:assert/strict";
import { test } from "node:test";

import {
  PORTAL_DICTIONARIES,
  formatPortalString,
  getPortalStrings,
} from "../src/lib/portal/i18n.ts";

// PORT-2 (план §7, тексты): портал двуязычный RU+KY. Пропущенный или пустой
// кыргызский ключ — это ошибка сборки словаря, а не повод молча показать
// английский текст.
test("every portal namespace ships a complete, non-empty Kyrgyz dictionary", () => {
  const namespaces = Object.keys(PORTAL_DICTIONARIES);
  assert.ok(namespaces.length > 0);

  for (const namespace of namespaces) {
    const { ru, ky } = PORTAL_DICTIONARIES[namespace];
    assert.deepEqual(
      Object.keys(ky).sort(),
      Object.keys(ru).sort(),
      `ky keys must mirror ru keys in namespace "${namespace}"`,
    );
    for (const locale of ["ru", "ky"]) {
      for (const [key, value] of Object.entries(PORTAL_DICTIONARIES[namespace][locale])) {
        assert.equal(typeof value, "string", `${namespace}.${key} (${locale})`);
        assert.notEqual(value.trim(), "", `${namespace}.${key} (${locale}) must not be empty`);
      }
    }
  }
});

test("portal strings resolve ky strictly and en deliberately falls back to ru", () => {
  const ky = getPortalStrings("shell", "ky");
  assert.equal(ky.logout, "Чыгуу");
  assert.equal(ky["nav.universities"], "Университеттер");

  const ru = getPortalStrings("shell", "ru");
  assert.equal(ru.logout, "Выйти");

  // Портал не имеет английской версии: en-локаль существующего механизма
  // (src/lib/i18n.ts) резолвится в RU, никогда не в случайный английский.
  assert.equal(getPortalStrings("shell", "en"), PORTAL_DICTIONARIES.shell.ru);
});

test("template substitution fills named values and leaves unknown markers visible", () => {
  assert.equal(
    formatPortalString("Открываем раздел «{label}»", { label: "Тесты" }),
    "Открываем раздел «Тесты»",
  );
  assert.equal(formatPortalString("{missing}", {}), "{missing}");
});
