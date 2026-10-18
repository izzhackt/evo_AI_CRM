import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { parseStudentCountryChoice } from "../src/lib/portal/country-choice.ts";
import { COUNTRY_TIMELINES } from "../src/lib/portal/country-timeline.ts";
import {
  CSCA_HOME_COUNTRY,
  CSCA_HOME_HREF,
  cscaHomeCardVisible,
  nearestCscaSession,
  selectCscaHomeCard,
} from "../src/lib/portal/csca-home-card.ts";
import { CSCA_OVERVIEW } from "../src/lib/portal/csca-overview.ts";
import { parseCscaHome } from "../src/lib/portal/csca.ts";
import { PORTAL_DICTIONARIES } from "../src/lib/portal/i18n.ts";
import { STUDY_COUNTRY_CODES } from "../src/lib/study-countries.ts";

// Карточка CSCA на «Главной» (Q16, 18.10.2026): видна только при выбранном
// Китае, одна строка обзора, ближайшая сессия, одно действие, без плашки ошибки.
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const fixture = (name) => JSON.parse(read(`tests/fixtures/portal-csca/${name}.json`));
const strings = (locale) => ({
  cscaStrings: PORTAL_DICTIONARIES.csca[locale],
  homeStrings: PORTAL_DICTIONARIES.home[locale],
});

/** Ответ `student_country_choice_v1` в форме сервера → разобранный выбор веба. */
const choice = (country, source = "saved") => parseStudentCountryChoice({
  country,
  source,
  savedAt: source === "saved" ? "2026-10-18T05:00:00+00:00" : null,
});

// Главная трека на 16.10.2026: сессия 2026-11 с окном регистрации до 21.10.
const home = (edit = (value) => value) => parseCscaHome(edit(fixture("track-home")));
const card = (inputChoice, inputHome, locale = "ru") => selectCscaHomeCard({
  choice: inputChoice,
  home: inputHome,
  locale,
  ...strings(locale),
});

test("only China shows the card, whether the choice is saved or the default", () => {
  assert.equal(CSCA_HOME_COUNTRY, "CN");
  assert.ok(STUDY_COUNTRY_CODES.includes(CSCA_HOME_COUNTRY));
  assert.equal(COUNTRY_TIMELINES.cn.country, CSCA_HOME_COUNTRY, "the card follows the same choice as the China path");
  // Сохранённый выбор, вывод из анкеты и из дела одинаково дают карточку.
  for (const source of ["saved", "application", "case"]) {
    assert.equal(cscaHomeCardVisible(choice("CN", source)), true, `CN ${source}`);
  }
  // Остальные пять стран, «Пока не решил» и отсутствие выбора карточки не дают.
  for (const country of STUDY_COUNTRY_CODES.filter((code) => code !== "CN")) {
    for (const source of ["saved", "application", "case"]) {
      assert.equal(cscaHomeCardVisible(choice(country, source)), false, `${country} ${source}`);
    }
  }
  assert.equal(cscaHomeCardVisible(choice("UNDECIDED")), false, "«Пока не решил»");
  assert.equal(cscaHomeCardVisible(choice(null, "none")), false, "нет выбора");
  assert.equal(cscaHomeCardVisible(null), false, "выбор не прочитался");
  // Код сравнивается точно: не регистр и не пробелы.
  assert.equal(cscaHomeCardVisible({ country: "cn" }), false);
  assert.equal(cscaHomeCardVisible({ country: " CN" }), false);
});

test("the card is hidden for every other choice, and without CSCA data it is hidden, not an error", () => {
  const data = home();
  for (const hidden of [choice("IT"), choice("MY", "application"), choice("UNDECIDED"), choice(null, "none"), null]) {
    assert.equal(card(hidden, data), null, JSON.stringify(hidden));
  }
  // Китай, но данные CSCA не загрузились (или их не читали): скрыта, ошибки нет.
  assert.equal(card(choice("CN"), null), null);
  assert.equal(card(choice("CN", "case"), null, "ky"), null);
});

test("China shows the title, the one summary line, the nearest session and one action", () => {
  const view = card(choice("CN"), home());
  assert.ok(view);
  assert.equal(view.title, "CSCA");
  // Строка из src/content/csca/overview.json без правок и без новых утверждений.
  assert.equal(view.summary, CSCA_OVERVIEW.summary.ru);
  assert.equal(view.action, "К подготовке");
  assert.equal(view.href, "/portal/csca");
  assert.ok(existsSync(new URL("../src/app/(portal)/portal/csca/page.tsx", import.meta.url)), "the action does not lead to a missing page");
  assert.match(view.session.line, /^Ближайшая сессия: 14 и 15 ноября 2026 г\.$/u);
  // 16.10 → окно закрывается 21.10 по Бишкеку: пять дней, формы числа как в разделе.
  assert.equal(view.session.registration, "Регистрация закрывается через 5 дней");
  assert.equal(Object.isFrozen(view), true);
});

test("the Kyrgyz card carries the same parts in Kyrgyz", () => {
  const view = card(choice("CN"), home(), "ky");
  assert.ok(view);
  assert.equal(view.title, "CSCA");
  assert.equal(view.summary, CSCA_OVERVIEW.summary.ky);
  assert.equal(view.action, PORTAL_DICTIONARIES.home.ky.cscaAction);
  assert.match(view.session.line, /^Жакынкы сессия: /u);
  assert.equal(view.session.registration, "Каттоо 5 күндөн кийин жабылат");
});

test("the registration line appears only for an open window of 60 days or less", () => {
  const withSession = (edit) => home((value) => {
    edit(value.sessions[0], value);
    return value;
  });
  // Окно закрывается сегодня.
  const today = card(choice("CN"), withSession((session, value) => {
    value.serverNow = "2026-10-21T10:00:00+00:00";
    value.today = "2026-10-21";
    return session;
  }));
  assert.equal(today.session.registration, "Регистрация закрывается сегодня");
  // Окно ещё не открылось, закрыто или не опубликовано: только даты сессии.
  const upcoming = card(choice("CN"), withSession((session) => {
    session.registrationOpensAt = "2026-10-20T07:00:00+00:00";
  }));
  assert.equal(upcoming.session.registration, null);
  const closed = card(choice("CN"), withSession((session, value) => {
    value.serverNow = "2026-10-22T10:00:00+00:00";
    value.today = "2026-10-22";
    return session;
  }));
  assert.equal(closed.session.registration, null, "registration closed");
  assert.match(closed.session.line, /14 и 15 ноября 2026 г\.$/u);
  const unpublished = card(choice("CN"), withSession((session) => {
    session.registrationOpensAt = null;
    session.registrationClosesAt = null;
  }));
  assert.equal(unpublished.session.registration, null);
  // Больше 60 дней до закрытия: срок не обещаем.
  const far = card(choice("CN"), withSession((session) => {
    session.registrationClosesAt = "2027-01-30T15:59:00+00:00";
  }));
  assert.equal(far.session.registration, null);
});

test("the nearest session skips finished ones and the card survives having none", () => {
  const sessions = home().sessions;
  assert.deepEqual(sessions.map((session) => session.sessionKey), ["2026-11", "2026-12", "2027-01", "2027-03", "2027-04", "2027-06"]);
  assert.equal(nearestCscaSession(sessions, "2026-10-16").sessionKey, "2026-11");
  // Последний день экзамена ещё идёт: сессия остаётся ближайшей.
  assert.equal(nearestCscaSession(sessions, "2026-11-15").sessionKey, "2026-11");
  assert.equal(nearestCscaSession(sessions, "2026-11-16").sessionKey, "2026-12");
  // Порядок ответа сервера не важен: по дате начала.
  assert.equal(nearestCscaSession([...sessions].reverse(), "2026-12-21").sessionKey, "2027-01");
  assert.equal(nearestCscaSession(sessions, "2027-06-28"), null);
  assert.equal(nearestCscaSession([], "2026-10-16"), null);

  const later = card(choice("CN"), home((value) => ({ ...value, serverNow: "2026-11-20T10:00:00+00:00", today: "2026-11-20" })));
  assert.match(later.session.line, /^Ближайшая сессия: 19 и 20 декабря 2026 г\.$/u);
  const none = card(choice("CN"), home((value) => ({ ...value, serverNow: "2027-07-01T10:00:00+00:00", today: "2027-07-01" })));
  assert.ok(none, "no upcoming session: title, summary and action stay");
  assert.equal(none.session, null);
  assert.equal(none.summary, CSCA_OVERVIEW.summary.ru);
  const empty = card(choice("CN"), home((value) => ({ ...value, sessions: [] })));
  assert.equal(empty.session, null);
  assert.equal(empty.action, "К подготовке");
});

test("the page reads the choice and the CSCA home in its single wave, only for China", () => {
  const page = read("src/app/(portal)/portal/home/page.tsx");
  const wave = page.match(/await Promise\.all\(\[\n([\s\S]*?)\n {2}\]\);/u);
  assert.ok(wave, "home reads stay in one Promise.all");
  assert.match(wave[1], /readStudentCountryChoice\(\)\.catch\(\(\): null => null\)\.then\(async \(choice\) => \(\{/u);
  assert.match(wave[1], /cscaHome: cscaHomeCardVisible\(choice\) \? await readCscaHome\(\)\.catch\(\(\): null => null\) : null,/u);
  // Волна одна: после проверки студента только один Promise.all, ожидание не добавлено.
  assert.equal(page.match(/await Promise\.all\(/gu)?.length, 2);
  assert.equal(page.match(/readCscaHome\(/gu)?.length, 1);
  assert.match(page, /selectCscaHomeCard\(\{\n\s+choice,\n\s+home: cscaHome,/u);
  assert.match(page, /csca=\{cscaCard \? <CscaHomeCard view=\{cscaCard\} \/> : null\}/u);
  assert.doesNotMatch(page, /\.rpc\(|\.schema\(/u);
});

test("the card opens «Продолжить» in the same grid as the other cards, for both tiers", () => {
  const view = read("src/components/portal/home/HomeView.tsx");
  const grid = view.indexOf('<div className="pt-home-grid">');
  const card = view.indexOf("{csca}");
  const english = view.indexOf('<p className="pt-home-card-kicker">{shell["nav.english"]}</p>');
  assert.ok(grid > 0 && card > grid && english > card, "CSCA is the first card of the grid");
  assert.equal(view.match(/\{csca\}/gu)?.length, 1, "one place for both tiers");
  assert.ok(view.indexOf('aria-labelledby="home-continue"') < grid, "the grid is the «Продолжить» section");
  // «Путь поступления» не тронут: у самостоятельного студента первым, у клиента после дела.
  assert.match(view, /\{tier === "assisted" \? null : journey\}/u);
  assert.match(view, /\{tier === "assisted" \? journey : null\}/u);
});

test("the card is quiet markup: one heading, one link, no alert and no extra client code", () => {
  const component = read("src/components/portal/home/CscaHomeCard.tsx");
  assert.doesNotMatch(component, /^"use client";/u);
  assert.doesNotMatch(component, /role="alert"|pt-alert|aria-live|useEffect|useState/u);
  assert.match(component, /<article className="pt-home-card pt-home-csca">/u);
  assert.equal(component.match(/<h3 /gu)?.length, 1);
  assert.equal(component.match(/<IntentPrefetchLink/gu)?.length, 1);
  assert.match(component, /<h3 id="home-csca" className="pt-home-card-title">\{view\.title\}<\/h3>/u);
  assert.match(component, /aria-describedby="home-csca"/u);
  assert.match(component, /className="pt-btn-ghost"/u);
  assert.match(component, /view\.session \? \(/u);
  assert.match(component, /view\.session\.registration \? \(/u);
  // Срок выделен весом, а не цветом; своих цветов и акцентов у карточки нет.
  const css = read("src/app/(portal)/portal.css");
  const rules = css.slice(css.indexOf(".pt-home-csca-session {"), css.indexOf("«Путь поступления» на «Главной» (S4"));
  assert.doesNotMatch(rules, /#[0-9a-f]{3,8}\b|rgb\(|var\(--pt-accent|var\(--pt-error/iu);
  assert.match(rules, /\.pt-home-csca-soon \{\n {2}color: var\(--pt-text\);\n {2}font-weight: 600;/u);
});

test("home strings exist in RU and KY, without dashes", () => {
  for (const locale of ["ru", "ky"]) {
    const dictionary = PORTAL_DICTIONARIES.home[locale];
    for (const key of ["cscaSession", "cscaRegistration", "cscaAction"]) {
      assert.ok(dictionary[key] && dictionary[key].length > 0, `${locale} ${key}`);
      assert.doesNotMatch(dictionary[key], /[\u2012-\u2015\u2212]/u, `${locale} ${key}`);
    }
    assert.match(dictionary.cscaSession, /\{dates\}/u);
    assert.match(dictionary.cscaRegistration, /\{closes\}/u);
    // Слово «Подготовка» не входит в название раздела (план v2 §9.1): оно только в действии.
    assert.equal(PORTAL_DICTIONARIES.csca[locale].title, "CSCA");
  }
  assert.equal(PORTAL_DICTIONARIES.home.ru.cscaAction, "К подготовке");
  assert.equal(CSCA_HOME_HREF, "/portal/csca");
});
