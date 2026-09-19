import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  CONSULTATION_NOTE_LIMIT,
  openConsultationRequest,
  parseConsultationHistory,
  parseConsultationReceipt,
} from "../src/lib/portal/consultation.ts";
import { PORTAL_DICTIONARIES } from "../src/lib/portal/i18n.ts";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const RECEIPT = {
  requestId: "19700000-0000-4000-8000-000000000801",
  status: "requested",
  institutionId: "19700000-0000-4000-8000-000000000601",
  institutionName: "P197 University Alpha",
  note: "Хочу обсудить поступление.",
  requestedAt: "2026-09-19T10:00:00+00:00",
  handledAt: null,
};

// PORT-5b: разбор receipt строгий — дрейф формы с сервера не превращается в
// тихо неполный экран или ложное «запрос отправлен».
test("consultation receipt parses strictly and fails closed on drift", () => {
  assert.deepEqual(parseConsultationReceipt(RECEIPT), RECEIPT);
  const handled = {
    ...RECEIPT,
    status: "handled",
    institutionId: null,
    institutionName: null,
    note: null,
    handledAt: "2026-09-19T12:00:00+00:00",
  };
  assert.deepEqual(parseConsultationReceipt(handled), handled);
  for (const broken of [
    null,
    [],
    { ...RECEIPT, status: "open" },
    { ...RECEIPT, requestId: "nope" },
    { ...RECEIPT, requestedAt: "yesterday" },
    // handled ⇔ handledAt: рассинхрон — отказ, не догадка.
    { ...RECEIPT, status: "handled" },
    { ...RECEIPT, handledAt: "2026-09-19T12:00:00+00:00" },
    { ...RECEIPT, note: "ы".repeat(CONSULTATION_NOTE_LIMIT + 1) },
    { ...RECEIPT, extra: 1 },
    Object.fromEntries(Object.entries(RECEIPT).filter(([key]) => key !== "note")),
  ]) {
    assert.equal(parseConsultationReceipt(broken), null, JSON.stringify(broken));
  }
});

test("consultation history honours the 20-item cap and rejects any broken entry", () => {
  assert.deepEqual(parseConsultationHistory([]), []);
  assert.deepEqual(parseConsultationHistory([RECEIPT]), [RECEIPT]);
  assert.equal(parseConsultationHistory([RECEIPT, { ...RECEIPT, status: "open" }]), null);
  assert.equal(parseConsultationHistory(Array.from({ length: 21 }, () => RECEIPT)), null);
  assert.equal(parseConsultationHistory({}), null);
});

test("the open request resolves from history and only the requested status counts", () => {
  const handled = {
    ...RECEIPT,
    requestId: "19700000-0000-4000-8000-000000000802",
    status: "handled",
    handledAt: "2026-09-19T12:00:00+00:00",
  };
  assert.equal(openConsultationRequest([handled, RECEIPT]), RECEIPT);
  assert.equal(openConsultationRequest([handled]), null);
  assert.equal(openConsultationRequest([]), null);
});

// Staff-очередь: строка несёт РОВНО объявленный набор ключей (план §6/§14 —
// никакие результаты тестов не попадают в staff-контекст) и читается тем же
// RPC, что закреплён миграцией 197.
test("the staff queue source pins the migration-197 contract", () => {
  const requestsSource = source("src/lib/v3/requests-source.ts");
  assert.match(requestsSource, /staff_portal_consultation_requests_v1/u);
  assert.match(
    requestsSource,
    /"handledAt,handledByName,id,institutionId,institutionName,note,requestedAt,status,studentName"/u,
  );
  assert.match(requestsSource, /"portal_consultation"\] as const/u);

  const action = source("src/lib/platform-portal-consultation-actions.ts");
  assert.match(action, /handle_portal_consultation_request_v1/u);
  // PT409 — честный конфликт состояния, не тихий успех и не бесконечный retry.
  assert.match(action, /PT409/u);
  assert.match(action, /staffHasPermission\(actor, "lead\.read"\)/u);
});

test("the requests screen adds the consultation pill additively", () => {
  const page = source("src/app/(v3)/v3/requests/page.tsx");
  assert.match(page, /portal_consultation: "Кабинет: консультации"/u);
  // Очередь лидов и анкет при этом фильтре не читается вовсе.
  assert.match(page, /filter === "portal_consultation"/u);
  assert.match(page, /<PortalConsultations queue=\{consultations\} readOnly=\{readOnly\} \/>/u);
});

// Портальная сторона: карточка вуза передаёт institution_id, профиль — нет;
// повтор идемпотентен на сервере (request_id стабилен на попытку).
test("the portal entry points wire the consultation request honestly", () => {
  const universityPage = source("src/app/(portal)/portal/universities/[id]/page.tsx");
  assert.match(universityPage, /readOwnConsultationRequests/u);
  assert.match(universityPage, /openConsultationRequest/u);

  const detail = source("src/components/portal/universities/Detail.tsx");
  assert.match(detail, /institutionId=\{university\.id\}/u);

  const profilePage = source("src/app/(portal)/portal/profile/page.tsx");
  assert.match(profilePage, /<ConsultationRequest\s+initialOpenRequest=/u);
  assert.doesNotMatch(
    profilePage,
    /<ConsultationRequest[^>]*institutionId/u,
    "the profile request must not carry an institution",
  );
  assert.match(profilePage, /ConsultationHistory/u);

  const component = source("src/components/portal/consultation/ConsultationRequest.tsx");
  assert.match(component, /useState\(\(\) => crypto\.randomUUID\(\)\)/u);
  assert.match(component, /createConsultationRequestAction/u);

  const actions = source("src/lib/portal/consultation-actions.ts");
  assert.match(actions, /create_portal_consultation_request_v1/u);
  assert.match(actions, /requireStudentPortalActor/u);
});

// Тексты — предметные и двуязычные: состояние после отправки — фактический
// результат, без обещаний сроков (план §6/§7).
test("the consultation dictionary carries the honest sent state in RU and KY", () => {
  const { ru, ky } = PORTAL_DICTIONARIES.consultation;
  assert.equal(ru.sent, "Запрос отправлен — менеджер свяжется.");
  assert.equal(ru.ctaButton, "Записаться на консультацию");
  assert.notEqual(ky.sent.trim(), "");
  assert.notEqual(ky.ctaButton.trim(), "");
});
