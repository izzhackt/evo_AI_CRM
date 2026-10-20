import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { selectCscaHomeCard, nearestCscaSession } from "../src/lib/portal/csca-home-card.ts";
import { cscaDayLabel, parseCscaHome } from "../src/lib/portal/csca.ts";
import { PORTAL_DICTIONARIES } from "../src/lib/portal/i18n.ts";
import { bishkekDay, sessionLabels, sessionRegistration } from "../src/components/portal/csca/session-labels.ts";

// Календарь сессий CSCA на настоящих данных: docs/design/portal/content/csca/sessions.json
// (сверка с csca.cn 21.10.2026, миграция 313) проходит через те же функции, что читает
// экран: разбор ответа `learning_track_home_v1`, «ближайшая сессия», подписи окна
// регистрации. Сервер отдаёт сессии, которые ещё не закончились по Бишкеку
// (`exam_to >= today`), и время `serverNow`; тест строит ответ так же и двигает часы
// через закрытие окна 21.10.2026 и конец каждой сессии. Ту же логику считает iPhone
// (`CSCASessionRegistration`, `CSCAHomeCardPolicy`), его тесты лежат в ios/.
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const calendar = JSON.parse(read("docs/design/portal/content/csca/sessions.json"));
const fixture = JSON.parse(read("tests/fixtures/portal-csca/track-home.json"));
const ru = PORTAL_DICTIONARIES.csca.ru;
const ky = PORTAL_DICTIONARIES.csca.ky;

/** Метка времени так, как её отдаёт Postgres в jsonb: UTC с `+00:00`. */
const utc = (value) => (value === null ? null : new Date(value).toISOString().replace(".000Z", "+00:00"));

/** Главная трека в момент `serverNow`: сессии, что ещё не закончились (день Бишкека), как RPC. */
function homeAt(serverNow, targetSessionKey = null) {
  const today = bishkekDay(serverNow);
  const sessions = calendar.sessions
    .filter((session) => session.exam_to >= today)
    .map((session) => ({
      sessionKey: session.session_key,
      examFrom: session.exam_from,
      examTo: session.exam_to,
      registrationOpensAt: utc(session.registration_opens_at),
      registrationClosesAt: utc(session.registration_closes_at),
      sourceUrl: calendar.source_url,
      verifiedOn: calendar.verified_on,
    }));
  return parseCscaHome({ ...structuredClone(fixture), serverNow, today, sessions, targetSessionKey });
}

const clock = (home) => ({ serverNow: home.serverNow, today: home.today });
const labelsAt = (serverNow, locale = "ru") => {
  const home = homeAt(serverNow);
  return sessionLabels(home.sessions, locale, locale === "ru" ? ru : ky, clock(home));
};
const cardAt = (serverNow, locale = "ru") => selectCscaHomeCard({
  choice: { country: "CN" },
  home: homeAt(serverNow),
  locale,
  cscaStrings: PORTAL_DICTIONARIES.csca[locale],
  homeStrings: PORTAL_DICTIONARIES.home[locale],
});

test("the calendar is the six official sessions of csca.cn verified on 21.10.2026", () => {
  assert.deepEqual(calendar.sessions.map((session) => [session.session_key, session.exam_from, session.exam_to]), [
    ["2026-11", "2026-11-14", "2026-11-15"],
    ["2026-12", "2026-12-19", "2026-12-20"],
    ["2027-01", "2027-01-23", "2027-01-24"],
    ["2027-03", "2027-03-13", "2027-03-14"],
    ["2027-04", "2027-04-24", "2027-04-25"],
    ["2027-06", "2027-06-26", "2027-06-27"],
  ]);
  assert.equal(calendar.verified_on, "2026-10-21");
  assert.equal(calendar.source_url, "https://csca.cn/home");
  // The only published window is 15.10 15:00 to 21.10 23:59 Beijing (UTC+8); the other
  // five are unpublished and stay empty, never guessed.
  const windows = calendar.sessions.filter((session) => session.registration_opens_at !== null);
  assert.deepEqual(windows.map((session) => session.session_key), ["2026-11"]);
  assert.equal(calendar.sessions[0].registration_opens_at, "2026-10-15T15:00:00+08:00");
  assert.equal(calendar.sessions[0].registration_closes_at, "2026-10-21T23:59:00+08:00");
  for (const session of calendar.sessions.slice(1)) {
    assert.equal(session.registration_opens_at, null, session.session_key);
    assert.equal(session.registration_closes_at, null, session.session_key);
  }
  // The screen says when the dates were checked: the newest verifiedOn of the home.
  const home = homeAt("2026-10-21T00:00:00+00:00");
  assert.equal(home.sessions.length, 6);
  assert.match(cscaDayLabel(home.sessions.map((session) => session.verifiedOn).sort().at(-1), "ru", true), /^21 октября 2026/u);
});

test("registration of 14 and 15 November closes 21.10.2026 23:59 Beijing = 21:59 Bishkek, and the screen follows the clock", () => {
  // 21.10 morning in Bishkek: open, closes today, a link to csca.cn.
  const morning = homeAt("2026-10-20T21:10:00+00:00");
  assert.equal(morning.today, "2026-10-21");
  assert.deepEqual(sessionRegistration(morning.sessions[0], morning.serverNow, morning.today),
    { state: "open", closesAt: "2026-10-21T15:59:00+00:00", daysLeft: 0 });
  const open = labelsAt("2026-10-20T21:10:00+00:00")["2026-11"];
  assert.match(open.registration, /^Регистрация до 21 октября\D*21:59 \(время Бишкека\)$/u);
  assert.equal(open.closesIn, "закрывается сегодня");
  assert.equal(open.registerUrl, "https://csca.cn");
  assert.equal(cardAt("2026-10-20T21:10:00+00:00").session.registration, "Регистрация закрывается сегодня");

  // The closing minute itself is still open (the window ends at 23:59:00 Beijing)...
  assert.equal(sessionRegistration(homeAt("2026-10-21T15:59:00+00:00").sessions[0], "2026-10-21T15:59:00+00:00", "2026-10-21").state, "open");
  // ...and one second later it is closed.
  const after = "2026-10-21T15:59:01+00:00";
  const closed = labelsAt(after)["2026-11"];
  assert.deepEqual(sessionRegistration(homeAt(after).sessions[0], after, "2026-10-21"), { state: "closed", closesAt: "2026-10-21T15:59:00+00:00" });
  assert.match(closed.registration, /^Регистрация закрыта 21 октября\D*21:59 \(время Бишкека\)$/u);
  assert.equal(closed.closesIn, null, "no countdown after the close");
  assert.equal(closed.registerUrl, null, "no link to register after the close");
  assert.match(labelsAt(after, "ky")["2026-11"].registration, /^Каттоо 21-октябрь\D*21:59 жабылды \(Бишкек убактысы\)$/u);

  // Closed registration does not hide the session itself: it is still the nearest (the
  // exam is not over), but the card no longer promises a registration line.
  const card = cardAt(after);
  assert.equal(card.session.line, "Ближайшая сессия: 14 и 15 ноября 2026 г.");
  assert.equal(card.session.registration, null);
  assert.equal(nearestCscaSession(homeAt(after).sessions, homeAt(after).today).sessionKey, "2026-11");
});

test("the next sessions, 19 and 20 December and 23 and 24 January, show an unpublished window until csca.cn opens it", () => {
  for (const serverNow of ["2026-10-21T15:59:01+00:00", "2026-11-01T00:00:00+00:00", "2026-11-14T08:00:00+00:00"]) {
    const labels = labelsAt(serverNow);
    for (const key of ["2026-12", "2027-01", "2027-03", "2027-04", "2027-06"]) {
      assert.equal(labels[key].registration, ru.sessionRegistrationPending, `${key} at ${serverNow}`);
      assert.equal(labels[key].closesIn, null, key);
      assert.equal(labels[key].registerUrl, null, key);
    }
    assert.equal(labels["2026-12"].dates, "19 и 20 декабря 2026 г.");
    assert.equal(labels["2027-01"].dates, "23 и 24 января 2027 г.");
  }
  assert.equal(labelsAt("2026-11-14T08:00:00+00:00", "ky")["2026-12"].registration, ky.sessionRegistrationPending);
});

test("a session leaves the list when its last exam day ends in Bishkek, and the next one becomes the nearest", () => {
  // 15.11 23:59 Bishkek: the exam day is still on.
  const lastMinute = homeAt("2026-11-15T17:59:00+00:00");
  assert.equal(lastMinute.today, "2026-11-15");
  assert.equal(lastMinute.sessions[0].sessionKey, "2026-11");
  assert.equal(nearestCscaSession(lastMinute.sessions, lastMinute.today).sessionKey, "2026-11");

  // 00:00 on 16.11: 14 and 15 November is past, 19 and 20 December is next.
  const next = homeAt("2026-11-15T18:00:00+00:00");
  assert.equal(next.today, "2026-11-16");
  assert.deepEqual(next.sessions.map((session) => session.sessionKey), ["2026-12", "2027-01", "2027-03", "2027-04", "2027-06"]);
  const card = cardAt("2026-11-15T18:00:00+00:00");
  assert.equal(card.session.line, "Ближайшая сессия: 19 и 20 декабря 2026 г.");
  assert.equal(card.session.registration, null, "the window of 12.2026 is not published");

  // Same step after 19 and 20 December.
  assert.equal(nearestCscaSession(homeAt("2026-12-20T17:59:00+00:00").sessions, "2026-12-20").sessionKey, "2026-12");
  assert.equal(cardAt("2026-12-20T18:00:00+00:00").session.line, "Ближайшая сессия: 23 и 24 января 2027 г.");

  // After the last session of the calendar there is no nearest one and the card keeps title and action.
  const done = cardAt("2027-06-27T18:00:00+00:00");
  assert.equal(done.session, null);
  assert.ok(done.title && done.action);
});

test("a Student's saved target that has passed is ignored by the screen, not an error", () => {
  const home = homeAt("2026-11-15T18:00:00+00:00", "2026-11");
  assert.equal(home.targetSessionKey, "2026-11");
  // SessionPicker and the iPhone list highlight a target only when the session is still listed.
  assert.ok(!home.sessions.some((session) => session.sessionKey === home.targetSessionKey));
  assert.equal(nearestCscaSession(home.sessions, home.today).sessionKey, "2026-12", "the nearest session does not depend on the target");
});
