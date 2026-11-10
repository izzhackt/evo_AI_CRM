import assert from "node:assert/strict";
import test from "node:test";

import {
  parseProfessionCard,
  parseProfessionCards,
  professionResonates,
  resolveLinkedPrograms,
  ProfessionParseError,
} from "../src/lib/portal/professions.ts";
import {
  groupProfessionsByScale,
  professionMatch,
  programNextStartMonth,
  programTuition,
  searchProfessions,
  topProfessionMatches,
} from "../src/lib/portal/profession-guide.ts";

const CARD_ID = "55555555-5555-4555-8555-555555555555";
const UNI_ID = "66666666-6666-4666-8666-666666666666";

const body = {
  id: "data-scientist",
  title_ru: "Дата-сайентист", title_ky: "Дата-сайентист KY",
  orvis_scales: ["analysis", "organization"],
  day_in_work_ru: "День.", day_in_work_ky: "Күн.",
  environment_ru: "Среда.", environment_ky: "Чөйрө.",
  skills_ru: ["Навык"], skills_ky: ["Көндүм"],
  interesting_ru: ["Интересно"], interesting_ky: ["Кызык"],
  hard_ru: ["Сложно"], hard_ky: ["Кыйын"],
  trial_task_ru: "Задание.", trial_task_ky: "Тапшырма.",
  study_directions_ru: ["Направление"], study_directions_ky: ["Багыт"],
  linked_program_refs: [
    { institution_photo_key: "ustc", program_hint: "Computer Science" },
  ],
  sources: ["https://www.onetonline.org/link/summary/15-2051.00"],
};

test("card summaries parse strictly and refuse an unknown scale", () => {
  const cards = parseProfessionCards({
    cards: [{
      cardId: CARD_ID, cardKey: "data-scientist", version: "1.0.0",
      titleRu: "Дата-сайентист", titleKy: "Дата-сайентист KY",
      orvisScales: ["analysis"],
    }],
  });
  assert.equal(cards[0].cardKey, "data-scientist");
  assert.throws(() => parseProfessionCards({
    cards: [{
      cardId: CARD_ID, cardKey: "x", version: "1.0.0",
      titleRu: "x", titleKy: "x", orvisScales: ["bravery"],
    }],
  }), ProfessionParseError);
});

test("full card parses the exact draft schema and misaligned KY lists fail", () => {
  const card = parseProfessionCard({
    cardId: CARD_ID, cardKey: "data-scientist", version: "1.0.0", body,
  });
  assert.equal(card.body.linked_program_refs.length, 1);
  assert.throws(() => parseProfessionCard({
    cardId: CARD_ID, cardKey: "data-scientist", version: "1.0.0",
    body: { ...body, skills_ky: ["Көндүм", "Экинчи"] },
  }), ProfessionParseError);
  assert.throws(() => parseProfessionCard({
    cardId: CARD_ID, cardKey: "data-scientist", version: "1.0.0",
    body: { ...body, sources: ["http://insecure.example"] },
  }), ProfessionParseError);
});

test("catalogue resolution is honest: found, program-missing and university-missing", () => {
  const universities = [{
    id: UNI_ID, version: 1, publishedAt: "2026-09-19T00:00:00Z",
    content: {
      name: "USTC", country: "CN", city: null, overview: "x",
      websiteUrl: "https://example.edu", sourceUrl: "https://example.edu", verifiedOn: "2026-09-19",
      notes: "", photoKey: "ustc",
      programs: [{ id: "cs", title: "Computer Science", level: "bachelor", duration: null, language: null, summary: "x", sourceUrl: "https://example.edu", intakes: [] }],
    },
  }];
  const [found] = resolveLinkedPrograms(
    [{ institution_photo_key: "ustc", program_hint: "Computer Science" }],
    universities,
  );
  assert.equal(found.institutionId, UNI_ID);
  assert.equal(found.programFound, true);

  const [programMissing] = resolveLinkedPrograms(
    [{ institution_photo_key: "ustc", program_hint: "Physics" }],
    universities,
  );
  assert.equal(programMissing.institutionId, UNI_ID);
  assert.equal(programMissing.programFound, false);

  const [universityMissing] = resolveLinkedPrograms(
    [{ institution_photo_key: "unknown-key", program_hint: "Physics" }],
    universities,
  );
  assert.equal(universityMissing.institutionId, null);
  assert.equal(universityMissing.programFound, false);
});

test("resonance is a client-side intersection with own top scales only", () => {
  assert.equal(professionResonates(["analysis", "organization"], ["analysis"]), true);
  assert.equal(professionResonates(["creativity"], ["analysis"]), false);
  assert.equal(professionResonates(["creativity"], null), false);
  assert.equal(professionResonates(["creativity"], []), false);
});

test("1.1.0 fields parse when present and stay null on 1.0.0 cards", () => {
  const [old] = parseProfessionCards({
    cards: [{
      cardId: CARD_ID, cardKey: "data-scientist", version: "1.0.0",
      titleRu: "Дата-сайентист", titleKy: "KY", orvisScales: ["analysis"],
    }],
  });
  assert.equal(old.summaryRu, null);
  const [fresh] = parseProfessionCards({
    cards: [{
      cardId: CARD_ID, cardKey: "data-scientist", version: "1.1.0",
      titleRu: "Дата-сайентист", titleKy: "KY", orvisScales: ["analysis"],
      summaryRu: "Находит закономерности в данных.", summaryKy: "Маалыматтардан мыйзам ченемдерди табат.",
    }],
  });
  assert.equal(fresh.summaryKy, "Маалыматтардан мыйзам ченемдерди табат.");
  assert.equal(parseProfessionCard({ cardId: CARD_ID, cardKey: "data-scientist", version: "1.0.0", body })
    .body.school_subjects_ru, null);
  const card = parseProfessionCard({
    cardId: CARD_ID, cardKey: "data-scientist", version: "1.1.0",
    body: { ...body, summary_ru: "Строка.", summary_ky: "Сап.", school_subjects_ru: ["Математика"], school_subjects_ky: ["Математика"] },
  });
  assert.deepEqual(card.body.school_subjects_ky, ["Математика"]);
  assert.throws(() => parseProfessionCard({
    cardId: CARD_ID, cardKey: "data-scientist", version: "1.1.0",
    body: { ...body, school_subjects_ru: ["Математика", "Физика"], school_subjects_ky: ["Математика"] },
  }), ProfessionParseError);
});

const summary = (key, titleRu, orvisScales, summaryRu = null) => ({
  cardId: CARD_ID, cardKey: key, version: "1.1.0", titleRu, titleKy: `${titleRu} KY`,
  orvisScales, summaryRu, summaryKy: null,
});

test("match percent is the mean interest on the profession's scales, with reasons", () => {
  const profile = {
    means: { analysis: 4.5, erudition: 4.1, creativity: 2.0, leadership: 1.0 },
    topScales: ["analysis", "erudition"],
  };
  const analyst = professionMatch(summary("analyst", "Аналитик", ["erudition", "analysis"]), profile);
  assert.equal(analyst.percent, Math.round(((4.5 - 1) / 4 + (4.1 - 1) / 4) / 2 * 100));
  assert.deepEqual(analyst.reasons, ["analysis", "erudition"]);
  const designer = professionMatch(summary("designer", "Дизайнер", ["creativity"]), profile);
  assert.equal(designer.percent, 25);
  assert.deepEqual(designer.reasons, ["creativity"], "no top scale: the strongest own scale is the reason");
  assert.equal(professionMatch(summary("guide", "Гид", ["adventure"]), profile), null, "unknown scale is not 0%");
  const top = topProfessionMatches([
    summary("designer", "Дизайнер", ["creativity"]),
    summary("analyst", "Аналитик", ["erudition", "analysis"]),
    summary("boss", "Руководитель", ["leadership"]),
  ], profile, 2);
  assert.deepEqual(top.map((match) => match.card.cardKey), ["analyst", "designer"]);
});

test("groups follow the primary scale in ORVIS order and search covers RU, KY and the summary", () => {
  const cards = [
    summary("analyst", "Аналитик", ["analysis", "leadership"], "Ищет закономерности."),
    summary("boss", "Руководитель", ["leadership"]),
    summary("nurse", "Медсестра", ["altruism"], "Ухаживает за пациентами."),
  ];
  assert.deepEqual(groupProfessionsByScale(cards).map((group) => [group.scale, group.cards.length]),
    [["leadership", 1], ["altruism", 1], ["analysis", 1]]);
  assert.deepEqual(searchProfessions(cards, "пациент", "ru").map((card) => card.cardKey), ["nurse"]);
  assert.deepEqual(searchProfessions(cards, "РУКОВОДИТЕЛЬ ky", "ru").map((card) => card.cardKey), ["boss"]);
  assert.equal(searchProfessions(cards, "  ", "ru").length, 3);
});

const cost = (patch) => ({
  id: "c", kind: "tuition", period: "year", studyLevel: null, programId: null, teachingLanguage: null,
  currency: "MYR", exponent: 2, amountMinMinor: 4_000_000, amountMaxMinor: null, usdApproxMin: 9_000,
  usdApproxMax: null, academicYear: null, note: null, source: { kind: "official", url: "https://example.edu" },
  verifiedOn: "2026-10-01", ...patch,
});

test("tuition prefers the program row, then its level, then the university row; never converts periods", () => {
  const program = { id: "cs", level: "bachelor" };
  const rows = [
    cost({ id: "general", amountMinMinor: 1_000_000, usdApproxMin: 2_000 }),
    cost({ id: "level", studyLevel: "bachelor", amountMinMinor: 3_000_000, usdApproxMin: 6_000 }),
    cost({ id: "program", programId: "cs", amountMinMinor: 5_000_000, usdApproxMin: 10_800 }),
    cost({ id: "semester", programId: "cs", period: "semester", amountMinMinor: 100 }),
  ];
  assert.equal(programTuition(rows, program).usdMin, 10_800);
  assert.equal(programTuition(rows.slice(0, 2), program).usdMin, 6_000);
  assert.equal(programTuition(rows.slice(0, 2), null).usdMin, 2_000);
  assert.equal(programTuition([rows[3]], program), null, "a semester price is not shown as a yearly one");
  const range = programTuition([
    cost({ programId: "cs", teachingLanguage: "en", amountMinMinor: 5_000_000, usdApproxMin: 10_000 }),
    cost({ programId: "cs", teachingLanguage: "zh", amountMinMinor: 3_000_000, usdApproxMin: 6_000 }),
  ], program);
  assert.deepEqual([range.minMinor, range.maxMinor, range.usdMin, range.usdMax], [3_000_000, 5_000_000, 6_000, 10_000]);
  const mixed = programTuition([
    cost({ currency: "CNY", usdApproxMin: 4_000 }), cost({ currency: "USD", exponent: 0, amountMinMinor: 5_000, usdApproxMin: 5_000 }),
  ], null);
  assert.deepEqual([mixed.currency, mixed.minMinor, mixed.maxMinor], ["USD", 4_000, 5_000]);
  assert.equal(programTuition([cost({ currency: "CNY", usdApproxMin: null }), cost({ currency: "USD", exponent: 0 })], null), null);
});

test("next start month uses open/announced intakes from this month on", () => {
  const intake = (patch) => ({
    label: "x", startDate: null, startMonth: null, applicationDeadline: null, deadlineTime: null, timezone: null,
    status: "open", note: "", sourceUrl: "https://example.edu", verifiedOn: "2026-10-01", ...patch,
  });
  const now = new Date("2026-11-10T00:00:00Z");
  assert.equal(programNextStartMonth({ intakes: [
    intake({ startMonth: "2026-09" }),
    intake({ startMonth: "2027-09", status: "announced" }),
    intake({ startDate: "2027-03-01", startMonth: "2027-03" }),
    intake({ startMonth: "2027-01", status: "closed" }),
    intake({ startMonth: "2026-12", status: "unknown" }),
  ] }, now), "2027-03");
  assert.equal(programNextStartMonth({ intakes: [intake({ startMonth: "2026-11" })] }, now), "2026-11");
  assert.equal(programNextStartMonth({ intakes: [] }, now), null);
});

test("migration 359 is generated byte-for-byte from the draft and the 1.1.0 additions", async () => {
  const { readFileSync } = await import("node:fs");
  const { MIGRATION_PATH, generateMigration, loadCardsV11 } = await import("../scripts/import/generate-profession-cards-v1-1.mjs");
  assert.equal(readFileSync(MIGRATION_PATH, "utf8"), generateMigration());
  const { cards } = loadCardsV11();
  assert.equal(cards.length, 24);
  for (const card of cards) {
    assert.equal(Object.keys(card).length, 24, `${card.id} carries the 24-key 1.1.0 body`);
    assert.ok(!("salary" in card), "no salary without a reliable regional source");
  }
});
