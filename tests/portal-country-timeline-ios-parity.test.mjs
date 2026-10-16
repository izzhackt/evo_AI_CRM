import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { COUNTRY_TIMELINES, COUNTRY_TIMELINE_FILE_KEYS, parseCountryTimelineFile } from "../src/lib/portal/country-timeline.ts";
import { parseStudentCountryChoice } from "../src/lib/portal/country-choice.ts";
import { PARITY_DATES, PARITY_FIXTURE, parityFixtureText } from "../scripts/portal/write-country-timeline-ios-parity.mjs";

// «Путь поступления» читают два парсера: веб (`JSON.parse`) и iPhone
// (`JSONDecoder`, ios/EVOAdmissions/Services/CountryTimeline.swift). При
// повторе ключа в объекте `JSON.parse` берёт последнее значение, а
// `JSONDecoder` первое; review #1208 M1 показал, что так iPhone мог бы
// показать Италию её собственным таймлайном `owner_review`. Поэтому файлы
// контента хранятся только в каноническом виде, а фикстура паритета iPhone
// обязана быть свежей (review #1208 m4).
const SCRIPT = fileURLToPath(new URL("../scripts/portal/write-country-timeline-ios-parity.mjs", import.meta.url));
const rawFile = (key) => readFileSync(new URL(`../src/content/timelines/${key}.json`, import.meta.url), "utf8");
const canonical = (text) => `${JSON.stringify(JSON.parse(text), null, 2)}\n`;

test("every timeline file is canonical JSON: no repeated key, no byte order mark, one formatting", () => {
  assert.deepEqual(COUNTRY_TIMELINE_FILE_KEYS, ["cn", "my", "ae", "tr", "it", "cz", "undecided"]);
  for (const key of COUNTRY_TIMELINE_FILE_KEYS) {
    const text = rawFile(key);
    assert.equal(text.charCodeAt(0) === 0xfeff, false, `${key}.json starts with a byte order mark`);
    assert.equal(text, canonical(text), `${key}.json is not canonical: a repeated key or other formatting`);
  }
});

test("the canonical check catches the repeated status key of review #1208 M1", () => {
  const text = rawFile("it");
  const marker = '  "status": "owner_review",\n';
  assert.ok(text.includes(marker), "it.json is owner_review");
  const repeated = text.replace(marker, `  "status": "approved",\n${marker}`);
  // JSON.parse keeps the last value, so the web still sees owner_review …
  assert.equal(JSON.parse(repeated).status, "owner_review");
  // … and only the canonical check notices the second reader's hazard.
  assert.notEqual(repeated, canonical(repeated));
});

test("the iPhone parity fixture is current for the content files", () => {
  assert.equal(readFileSync(PARITY_FIXTURE, "utf8"), parityFixtureText(),
    "run: node --experimental-strip-types scripts/portal/write-country-timeline-ios-parity.mjs");
  const check = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", SCRIPT, "--check"], {
    encoding: "utf8",
  });
  assert.equal(check.status, 0, check.stderr);
});

test("the parity fixture pins the validUntil boundary: dates stay on that day and hide the day after", () => {
  const fixture = JSON.parse(readFileSync(PARITY_FIXTURE, "utf8"));
  assert.deepEqual(Object.keys(fixture.files), [...COUNTRY_TIMELINE_FILE_KEYS]);
  for (const [key, file] of Object.entries(fixture.files)) {
    assert.equal(file.validUntil, COUNTRY_TIMELINES[key].validUntil, key);
    assert.ok(PARITY_DATES.includes(file.validUntil), `${key}: the fixture has no case on validUntil`);
    const next = new Date(`${file.validUntil}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    assert.ok(PARITY_DATES.includes(next.toISOString().slice(0, 10)), `${key}: the fixture has no case after validUntil`);
  }
  assert.equal(fixture.cases.length, 7 * 2 * PARITY_DATES.length + 2);
  for (const entry of fixture.cases) {
    const validUntil = fixture.files[entry.file].validUntil;
    assert.equal(entry.datesHidden, entry.today > validUntil, `${entry.choice} ${entry.locale} ${entry.today}`);
  }
  assert.ok(fixture.cases.some((entry) => entry.today === "2027-10-31" && entry.file === "cn" && !entry.datesHidden));
});

// The same edge cases as CountryTimelineTests.testTextRulesFollowJavaScriptSemantics
// on the iPhone (review #1208 n2): the Swift port now decides them as the web does.
test("the web parser decides the regex edge cases that the iPhone port mirrors", () => {
  const original = JSON.parse(rawFile("cn"));
  const mutate = (change) => {
    const copy = structuredClone(original);
    change(copy);
    return copy;
  };
  const item = (copy) => copy.steps[0].checklist[0];
  const rejected = {
    "step id with a final newline": (copy) => { copy.steps[0].id = "cn-1-route\n"; },
    "item id with a final newline": (copy) => { item(copy).id = "cn-1-01\n"; },
    "source url with a final newline": (copy) => {
      const source = copy.sources.find((entry) => entry.url);
      source.url = `${source.url}\n`;
    },
    "text ends with U+FEFF": (copy) => { item(copy).text = { ru: "Расскажите о себе.\ufeff", ky: "Айтыңыз." }; },
    "U+FEFF and a space": (copy) => { item(copy).text = { ru: "Расскажите\ufeff о себе.", ky: "Айтыңыз." }; },
    "vertical tab and a space": (copy) => { item(copy).text = { ru: "Расскажите\u000b о себе.", ky: "Айтыңыз." }; },
    ".pdf before a Cyrillic ending": (copy) => { item(copy).text = { ru: "Загрузите скан.pdfке.", ky: "Айтыңыз." }; },
  };
  assert.doesNotThrow(() => parseCountryTimelineFile(original, "cn"));
  for (const [name, change] of Object.entries(rejected)) {
    assert.throws(() => parseCountryTimelineFile(mutate(change), "cn"), /timeline cn:/u, name);
  }
  // U+0085 is not JavaScript whitespace: the web accepts it, and so does the iPhone.
  assert.doesNotThrow(() => parseCountryTimelineFile(mutate((copy) => {
    item(copy).text = { ru: "Расскажите о себе.\u0085", ky: "Айтыңыз." };
  }), "cn"));
  assert.equal(parseStudentCountryChoice({ country: "CN", source: "saved", savedAt: "2026-10-16T10:04:44Z\n" }), null);
});
