import assert from "node:assert/strict";
import test from "node:test";

import {
  parseProfessionCard,
  parseProfessionCards,
  professionResonates,
  resolveLinkedPrograms,
  ProfessionParseError,
} from "../src/lib/portal/professions.ts";

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
