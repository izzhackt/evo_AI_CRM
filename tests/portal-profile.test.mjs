import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  isPortalLanguage,
  parsePortalProfile,
} from "../src/lib/portal/portal-profile.ts";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const PROFILE = {
  displayName: "Student",
  email: "student@example.invalid",
  portalLanguage: "ru",
  caseState: "pending",
  deletionRequestedAt: null,
};

// PORT-5a: разбор get_own_portal_profile_v1 строгий — дрейф формы с сервера
// не превращается в тихо неполный экран профиля.
test("portal profile payload parses strictly and fails closed on drift", () => {
  assert.deepEqual(parsePortalProfile(PROFILE), PROFILE);
  assert.deepEqual(
    parsePortalProfile({
      ...PROFILE,
      portalLanguage: "ky",
      caseState: null,
      deletionRequestedAt: "2026-09-19T10:00:00+00:00",
    }),
    {
      ...PROFILE,
      portalLanguage: "ky",
      caseState: null,
      deletionRequestedAt: "2026-09-19T10:00:00+00:00",
    },
  );
  for (const broken of [
    null,
    [],
    { ...PROFILE, portalLanguage: "en" },
    { ...PROFILE, displayName: "" },
    { ...PROFILE, email: " " },
    { ...PROFILE, caseState: "archived" },
    { ...PROFILE, deletionRequestedAt: "2026-09-19" },
    { ...PROFILE, extra: 1 },
    Object.fromEntries(Object.entries(PROFILE).filter(([key]) => key !== "deletionRequestedAt")),
  ]) {
    assert.equal(parsePortalProfile(broken), null, JSON.stringify(broken));
  }
});

test("portal language accepts exactly ru and ky", () => {
  assert.ok(isPortalLanguage("ru"));
  assert.ok(isPortalLanguage("ky"));
  for (const wrong of ["en", "RU", "", null, undefined, 1]) {
    assert.equal(isPortalLanguage(wrong), false, String(wrong));
  }
});

// Структурные пины PORT-5a: профиль в Shell-нав обоих tier'ов; язык
// персистится через RPC И cookie в одном server action; удаление — реальный
// запрос со стабильным request_id и честным состоянием; бейдж в карточке
// клиента аддитивен (Pill в CaseHeader, staff-UI не перестраивается).
test("profile screen wiring stays in place", () => {
  const shell = source("src/components/portal/Shell.tsx");
  assert.match(
    shell,
    /\{ href: "\/portal\/profile", key: "nav\.profile", tiers: \["approved", "assisted"\] \}/u,
  );

  const actions = source("src/lib/portal/portal-profile-actions.ts");
  assert.match(actions, /^"use server";/u);
  assert.match(actions, /set_own_portal_language_v1/u);
  assert.match(actions, /store\.set\("locale", language/u, "the SAME action must update the locale cookie");
  // 280: запрос на удаление — отдельное действие для любого вошедшего аккаунта.
  const ownActions = source("src/lib/account-deletion/own-actions.ts");
  assert.match(ownActions, /^"use server";/u);
  assert.match(ownActions, /request_account_deletion_v2/u);

  const page = source("src/app/(portal)/portal/profile/page.tsx");
  assert.match(page, /href="\/portal\/tests"/u);
  assert.match(page, /logoutStudentPortalAction/u);
  assert.match(page, /<AccountDeletionPanel/u);
  assert.match(page, /readOwnAccountDeletion\(\)/u);

  const deletion = source("src/components/account-deletion/AccountDeletionPanel.tsx");
  assert.match(deletion, /useState\(\(\) => crypto\.randomUUID\(\)\)/u, "request_id must be stable per attempt");
  assert.match(deletion, /strings\.confirmQuestion/u, "an irreversible request asks for a second step");

  // Дело студента 26.09: шапка рисует пилюлю, а чтение запроса — в общем чтении дела.
  const header = source("src/components/v3/profile/CaseHeader.tsx");
  assert.match(header, /запросил удаление аккаунта/u);
  assert.match(source("src/lib/v3/case-work-source.ts"), /hasOpenAccountDeletionRequestForCase\(actor, target\.studentCaseId\)/u);
});

// Решения владельца 07.10.2026 заменяют «никаких сроков» плана §7: экран
// называет срок 30 дней и что хранится по закону — в обоих языках, без тире.
test("deletion strings name the 30-day deadline and the kept records", async () => {
  const { PORTAL_DICTIONARIES } = await import("../src/lib/portal/i18n.ts");
  const ru = PORTAL_DICTIONARIES.accountDeletion.ru;
  const ky = PORTAL_DICTIONARIES.accountDeletion.ky;
  assert.match(ru.description, /30 дней/u);
  assert.match(ky.description, /30 күн/u);
  for (const strings of [ru, ky]) {
    assert.match(strings.requested, /\{date\}/u);
    assert.match(strings.due, /\{date\}/u);
    for (const [key, value] of Object.entries(strings)) {
      assert.doesNotMatch(value, /[\u2013\u2014]/u, `${key} must not use en/em dashes`);
    }
  }
  assert.equal(Object.hasOwn(PORTAL_DICTIONARIES.profile.ru, "deleteDescription"), false);
});
