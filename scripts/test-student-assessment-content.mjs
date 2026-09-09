import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { generateSeed, loadAssessmentContent, ORVIS_SCALE_IDS, SEED_PATH } from "./generate-student-assessment-seed.mjs";

const [english, orvis] = loadAssessmentContent().map((source) => source.content);

test("published English bank has 12 original items per block, complete private keys and a blueprint", () => {
  for (const topic of ["grammar", "vocabulary", "reading"]) {
    assert.equal(english.questions.filter((question) => question.topic === topic).length, 12);
  }
  assert.deepEqual(english.metadata.blueprint.map((item) => item.questionId), english.questions.map((item) => item.id));
  assert.equal(new Set(english.questions.filter((q) => q.topic === "reading").map((q) => q.passage)).size, 3);
  for (const item of english.metadata.blueprint) {
    assert.ok(["foundation", "developing", "stretch"].includes(item.difficulty));
    assert.ok(item.skill);
  }
  assert.deepEqual(english.metadata.bands.map(({ id, min, max }) => ({ id, min, max })), [
    { id: "basic", min: 0, max: 17 },
    { id: "developing", min: 18, max: 27 },
    { id: "strong", min: 28, max: 36 },
  ]);
  assert.match(english.metadata.limitations.join(" "), /не подтверждённый уровень CEFR/);
});

test("ORVIS retains every original ID and the official eight unequal scale memberships", () => {
  const sourceIds = {
    leadership: [1,9,17,25,33,41,49,57,65,73,81,86],
    organization: [2,10,18,26,34,42,50,58,66,74,82,87,90],
    altruism: [3,11,19,27,35,43,51,59,67,75,83,88,91],
    creativity: [4,12,20,28,36,44,52,60,68,76,84,85,89,92],
    analysis: [5,13,21,29,37,45,53,61,69,77],
    production: [6,14,22,30,38,46,54,62,70,78],
    adventure: [7,15,23,31,39,47,55,63,71,79],
    erudition: [8,16,24,32,40,48,56,64,72,80],
  };
  assert.deepEqual(orvis.questions.map((q) => q.id), Array.from({ length: 92 }, (_, i) => String(i + 1)));
  assert.deepEqual(Object.keys(orvis.metadata.sourceItems).sort(), orvis.questions.map((q) => q.id).sort());
  for (const [scale, ids] of Object.entries(sourceIds)) {
    assert.deepEqual(Object.entries(orvis.gradingRules).filter(([, rule]) => rule.scale === scale).map(([id]) => Number(id)), ids);
  }
  assert.deepEqual(orvis.metadata.scales.map((scale) => scale.id), ORVIS_SCALE_IDS);
  assert.match(orvis.metadata.limitations.join(" "), /не валидирована/);
});

test("profession cards cover all eight interests without fit percentages or uncredited sources", () => {
  const cards = orvis.metadata.professions;
  assert.equal(cards.length, 16);
  assert.equal(new Set(cards.map((card) => card.id)).size, cards.length);
  for (const scale of ORVIS_SCALE_IDS) assert.equal(cards.filter((card) => card.scaleIds.includes(scale)).length, 2);
  for (const card of cards) {
    for (const field of ["title", "summary", "tryActivity", "editorialNote"]) assert.ok(card[field]?.trim(), `${card.id}.${field}`);
    for (const field of ["tasks", "skills", "studyDirections", "careerPath"]) assert.ok(card[field]?.length >= 2, `${card.id}.${field}`);
    assert.equal(card.source.url, `https://www.onetonline.org/link/summary/${card.source.occupationId}`);
    assert.equal(card.source.license, "CC BY 4.0");
    assert.equal(card.source.version, "O*NET 31.0");
    assert.equal(card.source.licenseUrl, "https://creativecommons.org/licenses/by/4.0/");
    assert.ok(card.source.publisher && card.source.retrievedOn);
    assert.ok(!("fitPercent" in card) && !("salary" in card));
  }
});

test("generated seed exactly matches committed artifact and inserts only private content", () => {
  const sql = generateSeed();
  assert.equal(readFileSync(SEED_PATH, "utf8"), sql);
  assert.equal((sql.match(/INSERT INTO platform_private\.student_assessment_versions/g) ?? []).length, 2);
  assert.doesNotMatch(sql, /ON CONFLICT|UPDATE platform|INSERT INTO auth\.|INSERT INTO platform\./);
  assert.ok(sql.endsWith("COMMIT;\n\n"));
});

function plainText(html) {
  return html.replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&").replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim();
}

if (process.argv.includes("--verify-source")) {
  test("live IPIP ORVIS key agrees with all 92 stored source phrases and scale assignments", async () => {
    const response = await fetch("https://ipip.ori.org/newORVISKey.htm", { signal: AbortSignal.timeout(30_000) });
    assert.ok(response.ok, `IPIP source HTTP ${response.status}`);
    const html = new TextDecoder("windows-1252").decode(await response.arrayBuffer());
    assert.match(plainText(html), /All items are \+keyed/);
    let scale = null;
    const seen = new Set();
    for (const match of html.matchAll(/<tr\b[\s\S]*?<\/tr>/gi)) {
      const cells = [...match[0].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => plainText(cell[1]));
      const heading = cells.find((cell) => ORVIS_SCALE_IDS.includes(cell.toLowerCase()));
      if (heading) scale = heading.toLowerCase();
      const id = cells[0]?.match(/^(\d+)\.$/)?.[1];
      if (!id) continue;
      assert.ok(scale, `Missing source scale for ${id}`);
      assert.equal(cells[1], plainText(orvis.metadata.sourceItems[id]), `Original source phrase ${id}`);
      assert.equal(orvis.gradingRules[id].scale, scale, `Original source scale ${id}`);
      seen.add(id);
    }
    assert.equal(seen.size, 92, "Live source parsing must prove every item; no partial-source pass");
  });
}
