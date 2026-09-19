import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  isPortalLanguage,
  parseAccountDeletionReceipt,
  parsePortalProfile,
} from "../src/lib/portal/portal-profile.ts";
import { parseAccountDeletionRequests } from "../src/lib/platform-account-deletion.ts";

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

test("deletion receipts resolve to an honest action result", () => {
  const receipt = {
    requestId: "19600000-0000-4000-8000-000000000801",
    status: "requested",
    requestedAt: "2026-09-19T10:00:00+00:00",
  };
  assert.deepEqual(parseAccountDeletionReceipt(receipt), {
    ok: true,
    requestedAt: receipt.requestedAt,
  });
  for (const broken of [
    null,
    { ...receipt, status: "done" },
    { ...receipt, requestId: "nope" },
    { ...receipt, requestedAt: "yesterday" },
  ]) {
    assert.deepEqual(parseAccountDeletionReceipt(broken), { ok: false }, JSON.stringify(broken));
  }
});

test("staff deletion-request rows parse strictly for the client-card badge", () => {
  const row = {
    requestId: "19600000-0000-4000-8000-000000000801",
    membershipId: "19600000-0000-4000-8000-000000000304",
    studentCaseId: "19600000-0000-4000-8000-000000000501",
    displayName: "P196 Pending Student",
    status: "requested",
    requestedAt: "2026-09-19T10:00:00+00:00",
  };
  assert.deepEqual(parseAccountDeletionRequests([row, { ...row, studentCaseId: null, requestId: row.membershipId }]), [
    row,
    { ...row, studentCaseId: null, requestId: row.membershipId },
  ]);
  for (const broken of [null, {}, [{ ...row, status: "open" }], [{ ...row, studentCaseId: "x" }]]) {
    assert.equal(parseAccountDeletionRequests(broken), null, JSON.stringify(broken));
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
  assert.match(actions, /request_account_deletion_v1/u);

  const page = source("src/app/(portal)/portal/profile/page.tsx");
  assert.match(page, /href="\/portal\/tests"/u);
  assert.match(page, /logoutStudentPortalAction/u);
  assert.match(page, /<DeleteAccountRequest/u);

  const deletion = source("src/components/portal/profile/DeleteAccountRequest.tsx");
  assert.match(deletion, /useState\(\(\) => crypto\.randomUUID\(\)\)/u, "request_id must be stable per attempt");
  assert.match(deletion, /strings\.deleteRequested/u);

  const header = source("src/components/v3/profile/CaseHeader.tsx");
  assert.match(header, /запросил удаление аккаунта/u);
  assert.match(header, /hasOpenAccountDeletionRequestForCase/u);
});

// План §7 (тексты) и §13: никаких обещаний сроков в состоянии запроса.
test("deletion strings promise no timelines", async () => {
  const { PORTAL_DICTIONARIES } = await import("../src/lib/portal/i18n.ts");
  for (const locale of ["ru", "ky"]) {
    const strings = PORTAL_DICTIONARIES.profile[locale];
    for (const key of ["deleteDescription", "deleteRequested"]) {
      assert.doesNotMatch(
        strings[key],
        /\d+\s*(час|дн|күн|саат)|в течение|ичинде/iu,
        `${key} (${locale})`,
      );
    }
  }
});
