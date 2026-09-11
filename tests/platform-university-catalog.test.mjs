import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { parseUniversityContent, parseUniversityDrafts, parseUniversityFilters, parseUniversityPage, universityPublicUrl, universityIntakeLabel, UNIVERSITY_PHOTOS } from "../src/lib/platform-university-catalog.ts";
import { universityBatchRequestId, universityContentHash, universityBatchRows } from "../src/lib/server/university-catalog-batch.ts";
const acceptedIdentities = JSON.parse(readFileSync(new URL("fixtures/university-catalog-accepted-identities.json", import.meta.url), "utf8"));
const clone = () => structuredClone(current.find((entry) => entry.key === "apu").content);
const id = "59948000-0000-4000-8000-000000000001";
const currentBundles = readdirSync(new URL("../src/lib/server/", import.meta.url)).filter((name) => /^university-catalog-reviewed-(?!content\.json$).+\.json$/.test(name));
const current = currentBundles.flatMap((name) => JSON.parse(readFileSync(new URL(`../src/lib/server/${name}`, import.meta.url), "utf8")));
test("the complete real research package parses, has campus photos, and retains existing identities", () => {
  assert.ok(current.length >= 140);
  const rows = universityBatchRows(current, []);
  assert.equal(rows.length, current.length);
  for (const entry of current) {
    assert.deepEqual(parseUniversityContent(entry.content), entry.content, entry.key);
    assert.ok(entry.content.photoKey, entry.key);
    const photo = UNIVERSITY_PHOTOS[entry.content.photoKey];
    assert.ok(photo?.caption && photo.author && photo.title && photo.license, entry.key);
    assert.ok(photo.path.startsWith("https://"), entry.key);
    assert.ok(universityPublicUrl(photo.sourceUrl), entry.key);
  }
  for (const old of acceptedIdentities) {
    const entry = current.find((row) => row.key === old.key);
    assert.ok(entry, old.key);
    assert.deepEqual([entry.content.name, entry.content.country, entry.content.city], [old.name, old.country, old.city], old.key);
  }
});
test("all country packages are wired into the real server source, never a published fallback", () => {
  const source = readFileSync(new URL("../src/lib/v3/university-source.ts", import.meta.url), "utf8");
  for (const name of currentBundles) assert.ok(source.includes(name), name);
  assert.match(source, /staff_university_catalog/);
  assert.match(source, /student_university_catalog/);
});
test("every institutional roster entry is represented, with explicit campus and legacy-key deduplication", () => {
  const roster = JSON.parse(readFileSync(new URL("../docs/design/v3/references/2026-09-10-university-source-roster.json", import.meta.url), "utf8"));
  const aliases = {
    "china-university-of-petroleum-east-china-upc": "upc-east-china",
    "east-china-university-of-science-and-technology-ecust": "ecust",
    "guangdong-university-of-technology-gdut": "gdut",
    "south-china-university-of-technology-scut": "scut",
    "xi-an-jiaotong-liverpool-university-xjtlu": "xjtlu",
    "zhejiang-university-of-technology-zjut": "zjut",
    "harbin-institute-of-technology-shenzhen": "harbin-institute-of-technology-hit",
    "beijing-institute-of-technology-beijing": "beijing-institute-of-technology-zhuhai-bit-zhuhai",
  };
  for (const entry of [...roster.universities, ...roster.rawAdditions]) assert.ok(current.some((row) => row.key === (aliases[entry.key] ?? entry.key)), entry.key);
});
test("content hashes ignore JSON property order and exact review retries retain their request IDs", () => {
  const content = current[0].content;
  assert.equal(universityContentHash(content), universityContentHash(Object.fromEntries(Object.entries(content).reverse())));
  assert.notEqual(universityContentHash(content), universityContentHash({ ...content, notes: content.notes + " Новая редакция." }));
  const scope = ["organization", "membership", current[0].key, universityContentHash(content), null, 0];
  assert.equal(universityBatchRequestId(scope, "stage"), universityBatchRequestId(scope, "stage"));
  assert.notEqual(universityBatchRequestId(scope, "stage"), universityBatchRequestId(scope, "publish"));
  assert.notEqual(universityBatchRequestId(scope, "stage"), universityBatchRequestId([...scope, "changed"], "stage"));
});
test("language courses have their own valid filter rather than masquerading as degree programmes", () => {
  assert.ok(current.flatMap((row) => row.content.programs).filter((p) => p.level === "language").length >= 27);
  assert.equal(parseUniversityFilters({ level: "language" }).level, "language");
});
test("forward migration photo vocabulary matches the fixed reviewed image registry", () => {
  const sql = readFileSync(new URL("../supabase/migrations/151_platform_university_catalog_completion.sql", import.meta.url), "utf8");
  const values = sql.match(/new_photo CONSTANT TEXT := \$new\$value->>'photoKey' IN \(([^)]+)\)/)[1].split(",").map((v) => v.slice(1, -1)).sort();
  assert.deepEqual(values, Object.keys(UNIVERSITY_PHOTOS).sort());
  assert.match(sql, /platform_private\.valid_university_content\(jsonb\)/);
  assert.match(sql, /platform_private\.university_catalog_page\(uuid,text,text,text,uuid,integer\)/);
  assert.match(sql, /'doctorate','language'/);
  assert.doesNotMatch(sql, /INSERT INTO|UPDATE platform\.|GRANT |DROP /i);
});
test("all real editorial templates have sources and no implied partnerships", () => {
  assert.equal(acceptedIdentities.length, 16);
  for (const { content } of current) {
    assert.deepEqual(parseUniversityContent(content), content);
    assert.ok(content.verifiedOn >= "2026-09-10");
    assert.ok(content.programs.every((program) => universityPublicUrl(program.sourceUrl)));
    assert.equal(Object.hasOwn(content, "partner"), false);
  }
  assert.equal(clone().photoKey, "apu");
});
test("source gaps remain null instead of imported stale or cross-level deadlines", () => {
  for (const key of ["apu", "sunway", "mmu"]) assert.ok(current.find((row) => row.key === key).content.programs.every((program) => program.intakes.every((intake) => intake.applicationDeadline === null)));
  const uncertain = clone().programs.find((p) => p.level === "foundation").intakes.find((i) => i.status === "needs_reconfirmation");
  assert.equal(uncertain.startDate, null); assert.equal(uncertain.startMonth, "2026-11"); assert.equal(uncertain.applicationDeadline, null);
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
test("real catalogue content renders known facts without missing-field or uncertain-intake UI", async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  // Compile the actual shared reader and photo component. React, ReactDOM and
  // Next remain real package imports; the child uses their ordinary SSR exports
  // rather than inheriting this suite's react-server condition.
  const compiled = await build({
    stdin: {
      contents: `
        import { readFileSync } from "node:fs";
        import { createElement } from "react";
        import { renderToStaticMarkup } from "react-dom/server";
        import { UniversityContentView } from "./src/components/v3/universities/UniversityCatalogue";
        const entries = ${JSON.stringify(currentBundles)}.flatMap((name) =>
          JSON.parse(readFileSync("src/lib/server/" + name, "utf8")));
        process.stdout.write(JSON.stringify(entries.map(({ key, content }) => ({
          key,
          html: renderToStaticMarkup(createElement(UniversityContentView, { content, now: new Date() }))
        }))));
      `,
      resolveDir: root,
      sourcefile: "university-reader-render-check.tsx",
      loader: "tsx",
    },
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
    target: "node22",
    packages: "external",
    jsx: "automatic",
    logLevel: "silent",
  });
  const execution = spawnSync(process.execPath, ["--input-type=commonjs"], {
    cwd: root,
    input: compiled.outputFiles[0].text,
    encoding: "utf8",
    env: { ...process.env, NODE_OPTIONS: "" },
    maxBuffer: 16 * 1024 * 1024,
    timeout: 30_000,
  });
  assert.ifError(execution.error);
  assert.equal(execution.status, 0, execution.stderr);
  const rendered = JSON.parse(execution.stdout);
  assert.equal(rendered.length, current.length);
  const escape = (value) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#x27;" })[char]);
  for (const { key, content } of current) {
    const html = rendered.find((row) => row.key === key)?.html;
    assert.ok(html, key);
    assert.doesNotMatch(html, />Нужно уточнить<|Сроки набора в этой карточке не подтверждены|Что важно уточнить|точное время не указано|Опубликованная версия/, key);
    assert.doesNotMatch(html, /<h3\b[^>]*>[^<]*требуется подтверждение/i, `${key}: no editorial notices in programme headings`);
    assert.doesNotMatch(html, /<dl\b[^>]*>\s*<\/dl>/, key);
    assert.ok(html.includes(escape(content.overview)), `${key}: authored overview retained`);
    assert.ok(html.includes(`href="${escape(content.websiteUrl)}"`), `${key}: official website`);
    assert.ok(html.includes(`href="${escape(content.sourceUrl)}"`), `${key}: institutional source`);
    assert.ok(html.includes(`src="${escape(UNIVERSITY_PHOTOS[content.photoKey].path)}"`), `${key}: real photo markup`);
    assert.ok(html.includes(`href="${escape(UNIVERSITY_PHOTOS[content.photoKey].licenseUrl)}"`), `${key}: photo attribution`);
    const articles = [...html.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/g)].map((match) => match[1]);
    assert.equal(articles.length, content.programs.length, `${key}: authored programmes retained`);
    for (const [index, program] of content.programs.entries()) {
      const article = articles[index];
      assert.ok(article.includes(escape(program.title)), `${key}/${program.id}: title`);
      assert.ok(article.includes(escape(program.summary)), `${key}/${program.id}: authored requirements retained`);
      assert.ok(article.includes(`href="${escape(program.sourceUrl)}"`), `${key}/${program.id}: official programme source`);
      assert.equal(/<dt\b[^>]*>Длительность<\/dt>/.test(article), program.duration !== null, `${key}/${program.id}: duration row`);
      assert.equal(/<dt\b[^>]*>Язык обучения<\/dt>/.test(article), program.language !== null, `${key}/${program.id}: language row`);
      if (program.duration) assert.ok(article.includes(escape(program.duration)), `${key}/${program.id}: duration value`);
      if (program.language) assert.ok(article.includes(escape(program.language)), `${key}/${program.id}: language value`);
      const shown = [...article.matchAll(/<h4\b[^>]*>([\s\S]*?)<\/h4>/g)].map((match) => match[1]);
      const known = program.intakes.filter((intake) => ["announced", "open", "closed"].includes(intake.status));
      assert.deepEqual(shown, known.map((intake) => escape(intake.label)), `${key}/${program.id}: only known intakes`);
      assert.equal([...article.matchAll(/<dt\b[^>]*>Начало обучения<\/dt>/g)].length, known.filter((intake) => intake.startDate || intake.startMonth).length, `${key}/${program.id}: start rows`);
      assert.equal([...article.matchAll(/<dt\b[^>]*>Срок подачи<\/dt>/g)].length, known.filter((intake) => intake.applicationDeadline).length, `${key}/${program.id}: deadline rows`);
    }
  }
  const apu = rendered.find((row) => row.key === "apu").html;
  assert.doesNotMatch(apu, /Ноябрь 2026 — уточнить день/);
  assert.match(apu, /28 сентября 2026/);
  const utm = rendered.find((row) => row.key === "utm").html;
  assert.match(utm, /17 июля 2026/);
  assert.match(utm, /Приём[^<]*закрыт/);
  const ecust = rendered.find((row) => row.key === "ecust").html;
  assert.match(ecust, /10 июля 2026/);
  assert.match(ecust, /self-sponsored/);
  assert.match(ecust, /30 апреля/);
  const macerata = rendered.find((row) => row.key === "university-of-macerata").html;
  assert.match(macerata, /12 лет/);
  assert.match(macerata, /английский B2/);
  assert.match(macerata, /Duolingo и EF SET не принимаются/);
  const ema = rendered.find((row) => row.key === "ecole-de-management-applique").html;
  assert.doesNotMatch(ema, /Язык обучения|язык группы уточнить/);
});
