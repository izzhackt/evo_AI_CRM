import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import {
  CSCA_OVERVIEW,
  CSCA_OVERVIEW_DASHES,
  CSCA_OVERVIEW_DATE,
  CSCA_OVERVIEW_FORBIDDEN,
  CSCA_OVERVIEW_PHOTOS,
  cscaGroupFacts,
  cscaHasStarted,
  cscaMinutesLabel,
  cscaScoreRangeLabel,
  parseCscaOverview,
  parseCscaOverviewPhotos,
} from "../src/lib/portal/csca-overview.ts";
import {
  CSCA_OVERVIEW_COOKIE,
  CSCA_OVERVIEW_COOKIE_PATH,
  cscaOverviewOpen,
  parseCscaOverviewChoice,
} from "../src/lib/portal/csca-overview-choice.ts";
import { cscaTopicNextLessons, cscaWeakTopicLesson, parseCscaHome } from "../src/lib/portal/csca.ts";
import { PORTAL_DICTIONARIES } from "../src/lib/portal/i18n.ts";
import { closesInLabel, sessionLabels, sessionRegistration } from "../src/components/portal/csca/session-labels.ts";

// Обзор экзамена над разделом «CSCA» (решение владельца 17.10.2026):
// src/content/csca/overview.json, манифест фото src/content/csca/photos.json.
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const json = (path) => JSON.parse(read(path));
const rawOverview = () => json("src/content/csca/overview.json");
const rawPhotos = () => json("src/content/csca/photos.json");
const photoKeys = new Set(CSCA_OVERVIEW_PHOTOS.map((photo) => photo.key));
const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/portal-csca/${name}.json`, import.meta.url), "utf8"));
const strings = { ru: PORTAL_DICTIONARIES.csca.ru, ky: PORTAL_DICTIONARIES.csca.ky };

/** Every {ru, ky} object of the overview with its path; sources are metadata, not student text. */
function l10nObjects(value, path = "$") {
  if (Array.isArray(value)) return value.flatMap((entry, index) => l10nObjects(entry, `${path}[${index}]`));
  if (typeof value !== "object" || value === null) return [];
  if ("ru" in value && "ky" in value) return [[path, value]];
  return Object.entries(value).filter(([key]) => !(path === "$" && key === "sources"))
    .flatMap(([key, entry]) => l10nObjects(entry, `${path}.${key}`));
}

const refuses = (mutate, reason) => {
  const raw = rawOverview();
  mutate(raw);
  assert.throws(() => parseCscaOverview(raw, photoKeys), reason);
};

test("the overview and its photo manifest pass the strict parsers", () => {
  assert.equal(CSCA_OVERVIEW.schemaVersion, 1);
  assert.equal(CSCA_OVERVIEW.kyStatus, "needs_native_proofreading");
  assert.equal(CSCA_OVERVIEW.confirmedOn, "2026-10-17");
  assert.deepEqual(CSCA_OVERVIEW.sources.map((source) => source.kind), ["owner"]);
  assert.deepEqual([...photoKeys].sort(), ["campus-sichuan", "campus-xiamen"]);
  assert.ok(photoKeys.has(CSCA_OVERVIEW.photos.hero) && photoKeys.has(CSCA_OVERVIEW.photos.audience));
});

test("the subjects and fees tables are the owner's tables, well formed", () => {
  const o = CSCA_OVERVIEW;
  assert.equal(o.exam.nameEn, "China Scholastic Competency Assessment");
  assert.equal(o.exam.universitiesTotal, 306);
  const rows = o.subjects.groups.flatMap((group) => group.subjects.map((subject) => [
    group.nameEn, subject.nameEn, subject.language.ru, subject.minutes, subject.questions, subject.scoreMin, subject.scoreMax,
  ]));
  assert.deepEqual(rows, [
    ["Professional Chinese", "Humanities", "Китайский", 90, 80, 0, 100],
    ["Professional Chinese", "STEM", "Китайский", 90, 80, 0, 100],
    ["Fundamental Subjects", "Mathematics", "Китайский или английский", 60, 48, 0, 100],
    ["Fundamental Subjects", "Physics", "Китайский или английский", 60, 48, 0, 100],
    ["Fundamental Subjects", "Chemistry", "Китайский или английский", 60, 48, 0, 100],
  ]);
  assert.equal(o.exam.subjectsTotal, rows.length);
  // EVO's own status is honest: only mathematics has lessons now (S5.1).
  assert.deepEqual(o.subjects.groups.flatMap((group) => group.subjects.map((subject) => subject.evo)),
    ["none", "none", "available", "later", "later"]);
  assert.deepEqual(o.fees.rows.map((row) => [row.minSubjects, row.maxSubjects, row.fee]), [[1, 1, 450], [2, null, 700]]);
  assert.equal(o.fees.currency, "CNY");
  assert.equal(cscaMinutesLabel(o, 90, "ru"), "90 мин");
  assert.equal(cscaMinutesLabel(o, 60, "ky"), "60 мүн");
  assert.equal(cscaScoreRangeLabel(o, { scoreMin: 0, scoreMax: 100 }, "ru"), "от 0 до 100");
  // Owner FAQ: three questions, labels in the normal order (question, then answer).
  assert.deepEqual(o.faq.items.map((item) => item.id), ["who", "dates", "graduate"]);
  assert.ok(o.faq.items.every((item) => item.question.ru.endsWith("?") && item.question.ky.endsWith("?")));
  assert.deepEqual(o.faq.items.map((item) => item.link?.target ?? null), [null, "sessions", null]);
});

test("RU and KY parity, no dashes, no promises, no dates in student text", () => {
  const objects = l10nObjects(rawOverview());
  assert.ok(objects.length > 40, String(objects.length));
  for (const [path, value] of objects) {
    assert.deepEqual(Object.keys(value).sort(), ["ky", "ru"], path);
    for (const locale of ["ru", "ky"]) {
      const text = value[locale];
      assert.equal(typeof text, "string", `${path}.${locale}`);
      assert.ok(text.length > 0 && text === text.trim(), `${path}.${locale}`);
      assert.doesNotMatch(text, CSCA_OVERVIEW_DASHES, `${path}.${locale}`);
      assert.doesNotMatch(text, CSCA_OVERVIEW_DATE, `${path}.${locale}`);
      for (const pattern of CSCA_OVERVIEW_FORBIDDEN) assert.doesNotMatch(text, pattern, `${path}.${locale}`);
    }
  }
  // Owner text dates are past on 17.10.2026 and never reach the screen.
  const studentText = objects.flatMap(([, value]) => [value.ru, value.ky]).join("\n");
  for (const past of [/2025/u, /2026/u, /феврал/iu, /февраль/iu, /21\.12/u, /25\.01/u, /15\.03/u, /Register Now/iu]) {
    assert.doesNotMatch(studentText, past);
  }
  // The exam and subject names stay English, as the module already shows them.
  assert.match(CSCA_OVERVIEW.intro[1].ru, /China Scholarship Council/u);
  assert.match(CSCA_OVERVIEW.intro[1].ky, /China Scholarship Council/u);
  // The dates answer quotes the real heading of the sessions block.
  const dates = CSCA_OVERVIEW.faq.items.find((item) => item.id === "dates");
  assert.ok(dates.answer[0].ru.includes(`«${strings.ru.sessionsHeading}»`));
  assert.ok(dates.answer[0].ky.includes(`«${strings.ky.sessionsHeading}»`));
});

test("the parser refuses dashes, promises, dates, gaps and unknown photos", () => {
  refuses((raw) => { raw.intro[0].ru = "CSCA \u2014 новый тест."; }, /em or en dash/u);
  refuses((raw) => { raw.audience.needed.text.ky = "CSCнын 306 университети кепилдик берет."; }, /forbidden wording/u);
  refuses((raw) => { raw.faq.items[1].answer[0].ru = "Регистрация до 14 февраля 2026."; }, /a date in student text/u);
  refuses((raw) => { raw.summary.ru = "Нужен для бакалавриата. 5 предметов, взнос 450 CNY или 700 CNY."; }, /does not say 306/u);
  refuses((raw) => { raw.fees.rows[1].minSubjects = 3; }, /without gaps/u);
  refuses((raw) => { raw.photos.hero = "campus-tsinghua"; }, /not a photo of the manifest/u);
  refuses((raw) => { raw.exam.subjectsTotal = 4; }, /does not match the subjects table/u);
  refuses((raw) => { raw.faq.items[0].question.ru = "Кто должен сдавать CSCA"; }, /ends with \?/u);
  refuses((raw) => { raw.subjects.groups[0].extra = true; }, /unknown key extra/u);
  refuses((raw) => { raw.subjects.formats.minutes.ky = "мүнөт"; }, /needs exactly the slots n/u);
  refuses((raw) => { raw.sources[0].kind = "agency"; }, /only owner-confirmed/u);
  const photos = rawPhotos();
  photos.photos[0].sourceName = "Unsplash";
  assert.throws(() => parseCscaOverviewPhotos(photos), /only Pexels/u);
  const noFallback = rawPhotos();
  noFallback.photos[1].files = noFallback.photos[1].files.filter((file) => file.format !== "jpeg");
  assert.throws(() => parseCscaOverviewPhotos(noFallback), /JPEG fallback/u);
});

/** Width and height from a JPEG SOF marker or a WebP VP8/VP8L/VP8X header. */
function imageSize(buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    for (let offset = 2; offset < buffer.length;) {
      const marker = buffer[offset + 1];
      const length = buffer.readUInt16BE(offset + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { format: "jpeg", height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
      }
      offset += 2 + length;
    }
  }
  if (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
    const chunk = buffer.toString("ascii", 12, 16);
    if (chunk === "VP8 ") return { format: "webp", width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
    if (chunk === "VP8L") {
      const bits = buffer.readUInt32LE(21);
      return { format: "webp", width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (chunk === "VP8X") return { format: "webp", width: buffer.readUIntLE(24, 3) + 1, height: buffer.readUIntLE(27, 3) + 1 };
  }
  throw new Error("unknown image");
}

test("photo files match the manifest, stay under 600 KB and are bundled by static import", () => {
  const directory = new URL("../src/content/csca/photos/", import.meta.url);
  const onDisk = readdirSync(directory).sort();
  const manifestFiles = CSCA_OVERVIEW_PHOTOS.flatMap((photo) => photo.files);
  assert.deepEqual(onDisk, manifestFiles.map((file) => file.path.replace(/^photos\//u, "")).sort());
  let total = 0;
  for (const file of manifestFiles) {
    const buffer = readFileSync(new URL(file.path.replace(/^photos\//u, ""), directory));
    total += buffer.length;
    assert.equal(buffer.length, file.bytes, file.path);
    assert.equal(createHash("sha256").update(buffer).digest("hex"), file.sha256, file.path);
    assert.deepEqual(imageSize(buffer), { format: file.format, width: file.width, height: file.height }, file.path);
  }
  assert.ok(total < 600_000, `${total} bytes`);
  for (const photo of CSCA_OVERVIEW_PHOTOS) {
    assert.equal(photo.sourceName, "Pexels");
    assert.match(photo.licenceUrl, /^https:\/\/www\.pexels\.com\/license\/$/u);
    assert.ok(photo.files.some((file) => file.format === "jpeg" && file.width === 720), photo.key);
  }
  // Static imports, one per manifest file: /portal/* public paths would hit the cabinet proxy.
  const imports = read("src/components/portal/csca/overview-photo-files.ts");
  const bundled = [...imports.matchAll(/"(photos\/[a-z0-9-]+\.(?:webp|jpg))": /gu)].map((match) => match[1]).sort();
  assert.deepEqual(bundled, manifestFiles.map((file) => file.path).sort());
  for (const path of bundled) assert.match(imports, new RegExp(`from "\\.\\./\\.\\./\\.\\./content/csca/${path.replace(".", "\\.")}"`, "u"));
  // No captions at all (the texts are checked above for partner wording): alt text and the discreet © credit only.
  const overview = read("src/components/portal/csca/Overview.tsx");
  assert.match(overview, /<PhotoRights/u);
  assert.doesNotMatch(overview, /<figcaption/u);
});

test("returning students get the compact overview, new students the full one", () => {
  const home = parseCscaHome(fixture("track-home"));
  assert.equal(cscaHasStarted(home), true);
  const fresh = {
    ...home,
    topics: home.topics.map((topic) => ({ ...topic, windowAnswers: 0, windowCorrect: 0, lessonCompleted: false, state: "not_started" })),
    lessons: home.lessons.map((lesson) => ({ ...lesson, completed: false, draftAttemptId: null, lastResult: null })),
    tests: home.tests.map((entry) => ({ ...entry, draft: null, lastResult: null })),
    review: { dueCount: 0, activeCount: 0, nextDueOn: null },
  };
  assert.equal(cscaHasStarted(fresh), false);
  assert.equal(cscaHasStarted({ ...fresh, review: { dueCount: 0, activeCount: 1, nextDueOn: "2026-10-18" } }), true);
  const sheet = read("src/components/portal/csca/OverviewSheet.tsx");
  assert.match(sheet, /aria-expanded=\{open\}/u);
  const page = read("src/app/(portal)/portal/csca/page.tsx");
  assert.ok(page.indexOf("<CscaOverview") < page.indexOf("<NextStep"), "the overview comes before the module");
  assert.match(page, /started=\{home !== null && cscaHasStarted\(home\)\}/u);
});

test("the viewer's open or collapsed choice is a cookie the server reads, so nothing jumps after hydration", () => {
  assert.equal(CSCA_OVERVIEW_COOKIE, "csca_overview");
  assert.equal(CSCA_OVERVIEW_COOKIE_PATH, "/portal");
  assert.deepEqual(["open", "closed", "", "OPEN", "1", undefined, null].map(parseCscaOverviewChoice), ["open", "closed", null, null, null, null, null]);
  // No choice: new students see it open, returning ones collapsed; a choice always wins.
  assert.deepEqual([[null, false], [null, true], ["open", true], ["closed", false]].map(([choice, started]) => cscaOverviewOpen(choice, started)),
    [true, false, true, false]);
  const page = read("src/app/(portal)/portal/csca/page.tsx");
  assert.match(page, /choice=\{parseCscaOverviewChoice\(cookieStore\.get\(CSCA_OVERVIEW_COOKIE\)\?\.value\)\}/u);
  const sheet = read("src/components/portal/csca/OverviewSheet.tsx");
  // The hydration snapshot is the server's cookie value, the client reads the same cookie: one render, no shift.
  assert.match(sheet, /useSyncExternalStore\(subscribeChoice, readChoice, \(\) => initialChoice \?\? ""\)/u);
  assert.match(sheet, /path=\$\{CSCA_OVERVIEW_COOKIE_PATH\}; max-age=\$\{CSCA_OVERVIEW_COOKIE_MAX_AGE\}; samesite=lax/u);
  assert.doesNotMatch(sheet, /localStorage/u);
  const overview = read("src/components/portal/csca/Overview.tsx");
  // The image of the first paint loads first: the hero when open, the thumbnail when collapsed.
  assert.match(overview, /const openAtLoad = cscaOverviewOpen\(choice, started\);/u);
  assert.match(overview, /eager=\{openAtLoad\}/u);
  assert.match(overview, /<Thumb photo=\{hero\} eager=\{!openAtLoad\} \/>/u);
});

test("narrow screens show a group's shared facts once, subjects keep only what differs", () => {
  for (const locale of ["ru", "ky"]) {
    for (const group of CSCA_OVERVIEW.subjects.groups) {
      const facts = cscaGroupFacts(CSCA_OVERVIEW, group, locale);
      // Today every group shares language, time, questions and scale.
      assert.deepEqual(facts.shared.map((fact) => fact.key), ["language", "duration", "questions", "scoreRange"], group.key);
      for (const subject of group.subjects) assert.deepEqual(facts.bySubject[subject.key], [], subject.key);
      const first = group.subjects[0];
      assert.deepEqual(facts.shared.map((fact) => fact.value), [
        first.language[locale], cscaMinutesLabel(CSCA_OVERVIEW, first.minutes, locale), String(first.questions), cscaScoreRangeLabel(CSCA_OVERVIEW, first, locale),
      ]);
    }
  }
  // A fact that differs inside a group stays with each subject.
  const [group] = CSCA_OVERVIEW.subjects.groups;
  const mixed = { ...group, subjects: [group.subjects[0], { ...group.subjects[1], minutes: 75 }] };
  const facts = cscaGroupFacts(CSCA_OVERVIEW, mixed, "ru");
  assert.deepEqual(facts.shared.map((fact) => fact.key), ["language", "questions", "scoreRange"]);
  assert.deepEqual(facts.bySubject[mixed.subjects[1].key].map((fact) => fact.value), ["75 мин"]);
  // Accessible names keep a space between the English name and its translation (review F4).
  const overview = read("src/components/portal/csca/Overview.tsx");
  assert.equal((overview.match(/\{group\.nameEn\}<\/span>\{" "\}/gu) ?? []).length, 2);
  assert.match(overview, /\{subject\.nameEn\}<\/span>\n\s+\{subject\.name \? <>\{" "\}/u);
});

test("an open registration window says when it closes, Bishkek time, N up to 60 days", () => {
  const session = (closes, opens = "2026-10-15T15:00:00+08:00") => ({
    sessionKey: "2026-11", examFrom: "2026-11-14", examTo: "2026-11-15",
    registrationOpensAt: opens, registrationClosesAt: closes, sourceUrl: "https://csca.cn/about/examintro", verifiedOn: "2026-10-16",
  });
  const now = { serverNow: "2026-10-17T06:00:00+00:00", today: "2026-10-17" };
  const open = session("2026-10-21T23:59:00+08:00");
  assert.deepEqual(sessionRegistration(open, now.serverNow, now.today), { state: "open", closesAt: open.registrationClosesAt, daysLeft: 4 });
  const ru = sessionLabels([open], "ru", strings.ru, now)["2026-11"];
  // csca.cn publishes 23:59 Beijing; the screen says 21:59 Bishkek (ICU words the joiner differently).
  assert.match(ru.registration, /^Регистрация до 21 октября\D*21:59 \(время Бишкека\)$/u);
  assert.equal(ru.closesIn, "закрывается через 4 дня");
  assert.equal(ru.registerUrl, "https://csca.cn");
  assert.equal(sessionLabels([open], "ky", strings.ky, now)["2026-11"].closesIn, "4 күндөн кийин жабылат");
  assert.deepEqual([1, 2, 5, 21, 0].map((days) => closesInLabel(days, "ru", strings.ru)),
    ["закрывается через 1 день", "закрывается через 2 дня", "закрывается через 5 дней", "закрывается через 21 день", "закрывается сегодня"]);
  const far = sessionLabels([session("2027-01-30T23:59:00+08:00")], "ru", strings.ru, now)["2026-11"];
  assert.equal(far.closesIn, null, "more than 60 days: the date alone");
  assert.equal(far.registerUrl, "https://csca.cn");
  const upcoming = sessionLabels([session("2026-12-01T23:59:00+08:00", "2026-11-20T15:00:00+08:00")], "ru", strings.ru, now)["2026-11"];
  assert.match(upcoming.registration, /^Регистрация откроется /u);
  assert.equal(upcoming.registerUrl, null);
  const closed = sessionLabels([session("2026-10-16T23:59:00+08:00")], "ru", strings.ru, now)["2026-11"];
  assert.match(closed.registration, /^Регистрация закрыта /u);
  assert.equal(closed.closesIn, null);
  const pending = sessionLabels([{ ...open, registrationOpensAt: null, registrationClosesAt: null }], "ru", strings.ru, now)["2026-11"];
  assert.equal(pending.registration, strings.ru.sessionRegistrationPending);
  assert.equal(strings.ru.sessionChoose, "Готовлюсь к этой");
});

test("a test result leads to the lesson of its weakest topic", () => {
  const home = parseCscaHome(fixture("track-home"));
  const next = cscaTopicNextLessons(home.topics, home.lessons);
  const withLessons = home.topics.filter((topic) => topic.hasLessons).map((topic) => topic.topicKey);
  assert.deepEqual(Object.keys(next).sort(), withLessons.sort());
  for (const entry of Object.values(next)) assert.ok(["lesson", "practice"].includes(entry.kind));
  const [first, second] = withLessons;
  const weak = cscaWeakTopicLesson([
    { topicKey: first, total: 2, correct: 1 },
    { topicKey: second, total: 1, correct: 0 },
    { topicKey: "m1-sets", total: 1, correct: 0 },
  ], next);
  assert.equal(weak?.topicKey, second, "lowest share among topics that have a lesson");
  assert.equal(cscaWeakTopicLesson([{ topicKey: first, total: 2, correct: 2 }], next), null);
  const runner = read("src/components/portal/csca/TimedTestRunner.tsx");
  assert.match(runner, /cscaWeakTopicLesson\(attempt\.result\.byTopic, nextLessons\)/u);
  assert.match(runner, /className=\{weak \? "pt-btn-ghost" : "pt-btn"\} href=\{homeHref\}>\{strings\.backToTopics\}/u);
});

test("a chosen answer is saved within seconds and the status never claims it early", () => {
  const runner = read("src/components/portal/csca/TimedTestRunner.tsx");
  assert.match(runner, /const SAVE_ON_CHOICE_MS = 1_500;/u);
  assert.match(runner, /Math\.max\(SAVE_ON_CHOICE_MS, SAVE_ON_MOVE_MS - sinceLast\)/u);
  assert.match(runner, /setSaveStatus\("pending"\)/u);
  assert.match(runner, /pending: strings\.saveSaving/u);
  assert.match(runner, /setSaveStatus\(dirtyRef\.current \? "saving" : "saved"\)/u);
  // The browser still warns before leaving with unsaved answers (exit guard: beforeunload).
  assert.match(read("src/lib/student-assessment-exit-guard.ts"), /beforeunload/u);
  assert.match(runner, /dirtyRef\.current \|\| retryRef\.current !== null/u);
});

test("new CSCA strings exist in RU and KY and follow the section rules", () => {
  for (const key of ["overviewToggle", "overviewChecked", "moduleHeading", "moduleStatus", "sessionRegister", "sessionRegistrationOpens",
    "sessionRegistrationClosed", "sessionClosesToday", "sessionClosesIn.one", "sessionClosesIn.few", "sessionClosesIn.many",
    "resultNextLesson", "resultNextPractice", "figureScrolls"]) {
    assert.ok(strings.ru[key] && strings.ky[key], key);
    assert.notEqual(strings.ru[key], strings.ky[key], key);
  }
  for (const key of ["subjectsLabel", "subject.math", "subjectLater", "subjectTopics"]) {
    assert.equal(key in strings.ru, false, `${key}: the subject strip is gone (critique F4)`);
  }
  assert.match(strings.ru["nextStep.testWhy"], /темах, где уже есть уроки/u);
  assert.match(strings.ru.sectionWeight, /экзамена по математике/u);
  assert.doesNotMatch(strings.ru.ownWork, /здесь это/u);
});
