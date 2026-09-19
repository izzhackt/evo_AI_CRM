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

// PORT-3a: шаблонные маркеры вида {date}/{count}/{author} обязаны совпадать
// между RU и KY — иначе подстановка молча оставит «{...}» в одной из локалей.
test("placeholder markers agree between ru and ky in every namespace", () => {
  const markers = (value) =>
    [...value.matchAll(/\{(\w+)\}/gu)].map((match) => match[1]).sort();
  for (const namespace of Object.keys(PORTAL_DICTIONARIES)) {
    const { ru, ky } = PORTAL_DICTIONARIES[namespace];
    for (const key of Object.keys(ru)) {
      assert.deepEqual(markers(ky[key]), markers(ru[key]), `${namespace}.${key}`);
    }
  }
});

// PORT-3a: каталог «Атлас» говорит на обоих языках, включая доменные подписи
// уровней/статусов и честные строки карты.
test("universities dictionary covers levels, intake statuses and honest map lines", () => {
  const ru = getPortalStrings("universities", "ru");
  const ky = getPortalStrings("universities", "ky");
  assert.equal(ru.detailLead, "Программы, условия поступления и даты наборов.");
  assert.equal(ky.viewList, "Тизме");
  assert.equal(ky["level.foundation"], "Даярдоо программасы");
  assert.equal(ky["intakeStatus.open"], "Булактын маалыматы боюнча кабыл алуу ачык");
  for (const strings of [ru, ky]) {
    assert.ok(strings.intakeDeadlineByDate.includes("{date}"));
    assert.ok(strings.mapWithoutPoint.includes("{count}"));
    assert.ok(strings.photoBy.includes("{author}"));
  }
});

test("template substitution fills named values and leaves unknown markers visible", () => {
  assert.equal(
    formatPortalString("Открываем раздел «{label}»", { label: "Тесты" }),
    "Открываем раздел «Тесты»",
  );
  assert.equal(formatPortalString("{missing}", {}), "{missing}");
});
