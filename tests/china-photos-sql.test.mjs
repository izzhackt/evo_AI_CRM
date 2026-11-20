import assert from "node:assert/strict";
import test from "node:test";

import { buildSql, isPhotoOnlyUpdate, loadPhotoInputs, photoTargets } from "../scripts/catalog/china-photos-sql.mjs";
import { isOfficialMediaLicense, onOfficialSite } from "../src/lib/university-photo-rights.ts";

const content = (photoKey, extra = {}) => ({
  name: "Example University", country: "CN", city: "Пример", overview: "Обзор.", websiteUrl: "https://www.example.edu.cn/",
  sourceUrl: "https://www.example.edu.cn/en/", verifiedOn: "2026-11-19", notes: "Заметка.", photoKey,
  programs: [{ id: "p1", name: "Computer Science", level: "bachelor" }], ...extra,
});
const card = (key, photoKey, extra) => ({ key, content: content(photoKey, extra) });
const inputs = (overrides = {}) => ({
  cards: [card("example-university", "example-university"), card("other-university", null, { name: "Other University" })],
  library: { "example-university": { path: "https://www.example.edu.cn/a.jpg" } },
  photoKeys: ["example-university"],
  ...overrides,
});

test("photo-only update: only photoKey goes from null to a key", () => {
  assert.equal(isPhotoOnlyUpdate(content(null), content("example-university")), true);
  // Key order does not matter, as with jsonb equality in the database.
  const reordered = Object.fromEntries(Object.entries(content("example-university")).reverse());
  assert.equal(isPhotoOnlyUpdate(content(null), reordered), true);
});

test("photo-only update refuses any other change and any photo that was already set", () => {
  assert.equal(isPhotoOnlyUpdate(content(null), content("example-university", { overview: "Другой обзор." })), false);
  assert.equal(isPhotoOnlyUpdate(content(null), content("example-university", { programs: [] })), false);
  assert.equal(isPhotoOnlyUpdate(content("old-photo"), content("example-university")), false);
  assert.equal(isPhotoOnlyUpdate(content(null), content(null)), false);
  assert.equal(isPhotoOnlyUpdate(content(null), content("")), false);
  const withoutPhoto = Object.fromEntries(Object.entries(content(null)).filter(([key]) => key !== "photoKey"));
  assert.equal(isPhotoOnlyUpdate(withoutPhoto, content("example-university")), false);
  assert.equal(isPhotoOnlyUpdate(null, content("example-university")), false);
});

test("targets are exactly the listed keys, each a China card whose photoKey is its own key and is in the library", () => {
  assert.deepEqual(photoTargets(inputs()).map((target) => target.key), ["example-university"]);
  assert.throws(() => photoTargets(inputs({ photoKeys: ["missing-university"] })), /no such card/);
  assert.throws(() => photoTargets(inputs({ photoKeys: ["other-university"] })), /photoKey must equal its key/);
  assert.throws(() => photoTargets(inputs({ library: {} })), /missing from the photo library/);
  assert.throws(() => photoTargets(inputs({ photoKeys: ["example-university", "example-university"] })), /duplicates/);
  assert.throws(() => photoTargets(inputs(), ["other-university"]), /not a C8 photo key/);
  const notChina = inputs({ cards: [card("example-university", "example-university", { country: "MY" })] });
  assert.throws(() => photoTargets(notChina), /not a China card/);
});

test("the SQL rolls back by default, commits only on request and guards photo-only changes in the database", () => {
  const dry = buildSql({ inputs: inputs() });
  assert.equal(dry.cards, 1);
  assert.match(dry.sql, /\nROLLBACK;\n$/);
  assert.doesNotMatch(dry.sql, /\nCOMMIT;/);
  assert.match(buildSql({ inputs: inputs(), commit: true }).sql, /\nCOMMIT;\n$/);
  // Same guard as isPhotoOnlyUpdate: everything except photoKey equal, photo was null, becomes a string.
  assert.match(dry.sql, /\(old - 'photoKey'\) = \(c\.content - 'photoKey'\) AND jsonb_typeof\(old -> 'photoKey'\) = 'null'/);
  assert.match(dry.sql, /RAISE EXCEPTION 'card % differs from the file in more than its photo: refusing'/);
  // Writes go through the same Admin RPCs as the CRM, under the authenticated role.
  assert.match(dry.sql, /SET LOCAL ROLE authenticated/);
  assert.match(dry.sql, /platform\.stage_university_catalog_publication\(/);
  assert.match(dry.sql, /platform\.review_university_catalog_publication\(org, \(draft ->> 'draftId'\)::UUID, 'publish'/);
  assert.equal(buildSql({ inputs: inputs() }).digest, dry.digest, "the same input gives the same SQL");
  assert.throws(() => buildSql({ inputs: inputs(), actorMembership: "not-a-uuid" }), /UUID/);
});

test("C8 data: every listed card shows its own library photo; official photos come from that card's own site", () => {
  const inputs = loadPhotoInputs();
  const targets = photoTargets(inputs);
  assert.equal(targets.length, inputs.photoKeys.length);
  assert.ok(targets.length >= 80, `C8 photos: ${targets.length}`);
  for (const card of targets) {
    const photo = inputs.library[card.key];
    if (isOfficialMediaLicense(photo.license)) {
      assert.ok(onOfficialSite(photo.sourceUrl, card.content.websiteUrl), `${card.key}: ${photo.sourceUrl} is not on ${card.content.websiteUrl}`);
      assert.match(photo.author, /— официальный сайт; фотограф не указан$/u, card.key);
    }
    assert.doesNotMatch(photo.caption, /[.]$/u, card.key);
  }
});

test("the SQL carries only the C8 cards, never the other China cards", () => {
  const { sql } = buildSql({ inputs: inputs() });
  assert.match(sql, /\$k\$example-university\$k\$/);
  assert.doesNotMatch(sql, /other-university/);
});
