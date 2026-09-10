import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseUniversityContent, parseUniversityDrafts, parseUniversityFilters, parseUniversityPage, universityPublicUrl, universityIntakeLabel } from "../src/lib/platform-university-catalog.ts";
const bundle = JSON.parse(readFileSync(new URL("../src/lib/server/university-catalog-reviewed-content.json", import.meta.url), "utf8"));
const clone = () => structuredClone(bundle[0].content);
const id = "59948000-0000-4000-8000-000000000001";
test("all sixteen real editorial templates parse, have sources and no implied partnerships", () => {
  assert.deepEqual(bundle.map((entry) => entry.key), ["apu", "sunway", "mmu", "xjtlu", "unnc", "taylors", "inti", "ucsi", "city-malaysia", "xiamen-malaysia", "monash-malaysia", "scut", "zjut", "gdut", "upc-east-china", "ecust"]);
  for (const { content } of bundle) {
    assert.deepEqual(parseUniversityContent(content), content);
    assert.equal(content.verifiedOn, "2026-09-10");
    assert.ok(content.programs.every((program) => universityPublicUrl(program.sourceUrl)));
    assert.equal(Object.hasOwn(content, "partner"), false);
  }
  assert.equal(bundle[0].content.photoKey, null);
});
test("source gaps remain null instead of imported stale or cross-level deadlines", () => {
  for (const key of ["apu", "sunway", "xjtlu", "unnc"]) assert.ok(bundle.find((row) => row.key === key).content.programs.every((program) => program.intakes.every((intake) => intake.applicationDeadline === null)));
  const mmu = bundle.find((row) => row.key === "mmu").content.programs[0].intakes[0];
  assert.equal(mmu.applicationDeadline, "2026-09-23"); assert.equal(mmu.startDate, null); assert.equal(mmu.status, "needs_reconfirmation");
  assert.match(bundle.find((row) => row.key === "xjtlu").content.programs[0].title, /^BEng/);
});
test("content is closed at all nesting levels and rejects private metadata", () => {
  for (const target of ["root", "program", "intake"]) {
    const value = clone(); const row = target === "root" ? value : target === "program" ? value.programs[0] : value.programs[0].intakes[0];
    row.internalNotes = "private"; assert.equal(parseUniversityContent(value), null);
  }
  for (const value of [null, {}, [], "text", 1]) assert.equal(parseUniversityContent(value), null);
});
test("HTTPS links reject credentials, ports, private literals, fragments and secrets", () => {
  for (const url of ["http://university.edu", "https://user:pass@university.edu", "https://127.0.0.1", "https://[::1]", "https://university.local", "https://university.edu:8080", "https://university.edu#token", "https://university.edu?token=x", "https://university.edu?%74oken=x", "https://university.edu?authorization", "https://university.edu\\@other.edu", " HTTPS://university.edu"]) assert.equal(universityPublicUrl(url), false, url);
  assert.equal(universityPublicUrl("https://future-university.ac.uk/course?id=123"), true);
});
test("dates, timezone, repeated program IDs and control characters are rejected", () => {
  const variants = [
    (v) => v.programs[0].intakes[0].applicationDeadline = "2026-02-30",
    (v) => v.programs[0].intakes[0].deadlineTime = "17:00",
    (v) => v.programs[0].intakes[0].timezone = "not/a-timezone",
    (v) => v.programs[0].intakes[0].startMonth = "2026-11",
    (v) => v.programs.push(structuredClone(v.programs[0])),
    (v) => v.programs[0].id = 1,
    (v) => v.name += "\u0000",
    (v) => v.programs = [],
  ];
  for (const mutate of variants) { const v = clone(); mutate(v); assert.equal(parseUniversityContent(v), null); }
});
test("deadline display ages correctly in declared timezone without opening unknown intakes", () => {
  const intake = { ...clone().programs[0].intakes[0], applicationDeadline: "2026-09-23", deadlineTime: "17:00", timezone: "Asia/Shanghai", status: "open" };
  assert.match(universityIntakeLabel(intake, new Date("2026-09-23T08:59:00Z")), /открыт/);
  assert.match(universityIntakeLabel(intake, new Date("2026-09-23T09:01:00Z")), /закрыт/);
  assert.match(universityIntakeLabel({ ...intake, applicationDeadline: null, deadlineTime: null, status: "unknown" }, new Date("2026-09-23T09:01:00Z")), /уточнения/);
});
test("query filters reject duplicate/unknown fields and retain non-initial countries", () => {
  assert.deepEqual(parseUniversityFilters({ q: "University", country: "DE", level: "master", offset: "30" }), { query: "University", country: "DE", level: "master", offset: 30 });
  for (const value of [{ country: ["CN", "MY"] }, { q: ["a", "b"] }, { case: id }, { offset: "01" }, { offset: "50001" }, { level: "all" }, { country: "China" }]) assert.equal(parseUniversityFilters(value), null);
});
test("published and draft DTOs reject raw registry/provenance extras and malformed versions", () => {
  const item = { id, version: 1, publishedAt: "2026-09-10T00:00:00+00:00", content: clone() };
  assert.deepEqual(parseUniversityPage({ items: [item], nextOffset: null }), { items: [item], nextOffset: null });
  assert.equal(parseUniversityPage({ items: [{ ...item, source_registry_id: id }], nextOffset: null }), null);
  assert.equal(parseUniversityPage({ items: [item, item], nextOffset: null }), null);
  assert.equal(parseUniversityPage({ items: [{ ...item, version: "1" }], nextOffset: null }), null);
  const draft = { id, institutionId: null, baseVersion: 0, createdAt: "2026-09-10T00:00:00Z", status: "draft", content: clone(), reason: "Review source" };
  assert.deepEqual(parseUniversityDrafts([draft]), [draft]);
  assert.equal(parseUniversityDrafts([{ ...draft, email: "private@example.invalid" }]), null);
});
