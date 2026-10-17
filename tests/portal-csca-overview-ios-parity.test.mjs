import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { PARITY_FIXTURE, VECTORS, parityFixtureText, webDecision } from "../scripts/portal/write-csca-overview-ios-parity.mjs";

// Обзор CSCA читают два парсера: веб (src/lib/portal/csca-overview.ts) и
// iPhone (ios/EVOAdmissions/Services/CSCA/CSCAOverview.swift, ресурсы bundle).
// Фикстура паритета хранит решения веба на вариантах файлов и отпечатки
// разобранного; CSCAOverviewTests сверяет с ними порт iPhone. Здесь она
// обязана быть свежей, а файлы читаемыми обоими парсерами одинаково.
const SCRIPT = fileURLToPath(new URL("../scripts/portal/write-csca-overview-ios-parity.mjs", import.meta.url));
const raw = (name) => readFileSync(new URL(`../src/content/csca/${name}`, import.meta.url));

/** Повтор ключа в любом объекте: `JSON.parse` берёт последнее значение, `JSONDecoder` первое. */
function repeatedKey(text) {
  const stack = [];
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "{") stack.push({ keys: new Set(), expectingKey: true });
    else if (char === "[") stack.push(null);
    else if (char === "}" || char === "]") stack.pop();
    else if (char === "," && stack.at(-1)) stack.at(-1).expectingKey = true;
    else if (char === '"') {
      let end = index + 1;
      while (text[end] !== '"') end += text[end] === "\\" ? 2 : 1;
      const top = stack.at(-1);
      if (top && top.expectingKey) {
        const key = JSON.parse(text.slice(index, end + 1));
        if (top.keys.has(key)) return key;
        top.keys.add(key);
        top.expectingKey = false;
      }
      index = end;
    }
  }
  return null;
}

test("the overview files read the same in both parsers: no byte order mark, no repeated key", () => {
  for (const name of ["overview.json", "photos.json"]) {
    const bytes = raw(name);
    assert.notDeepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], `${name} starts with a byte order mark`);
    assert.equal(repeatedKey(bytes.toString("utf8")), null, `${name} repeats a key`);
  }
  assert.equal(repeatedKey('{"a": {"b": 1, "b": 2}}'), "b");
  assert.equal(repeatedKey('{"a": [{"b": 1}, {"b": 2}], "c": "{\\"a\\": 1}"}'), null);
});

test("the iPhone parity fixture is current for the overview files and parser", () => {
  assert.equal(readFileSync(PARITY_FIXTURE, "utf8"), parityFixtureText(),
    "run: node --experimental-strip-types scripts/portal/write-csca-overview-ios-parity.mjs");
  const check = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", SCRIPT, "--check"], { encoding: "utf8" });
  assert.equal(check.status, 0, check.stderr);
});

test("the shared variants cover every refusal the web overview test names, and some are accepted", () => {
  const decisions = VECTORS.map((vector) => [vector.id, webDecision(vector)]);
  const reasons = decisions.map(([, decision]) => decision).join("\n");
  for (const reason of [
    /em or en dash/u, /forbidden wording/u, /a date in student text/u, /does not say 306/u, /without gaps/u,
    /not a photo of the manifest/u, /does not match the subjects table/u, /ends with \?/u, /unknown key extra/u,
    /needs exactly the slots n/u, /only owner-confirmed/u, /only Pexels/u, /JPEG fallback/u, /WebP source/u,
    /digit groups need U\+00A0 or U\+202F/u, /mixed script word/u, /empty or untrimmed text/u, /duplicate key/u,
  ]) {
    assert.match(reasons, reason);
  }
  const accepted = decisions.filter(([, decision]) => decision === "accept").map(([id]) => id).sort();
  assert.deepEqual(accepted, [
    "Latin word with a Kyrgyz ending", "dates answer without a link", "digit groups with U+00A0", "digit groups with U+202F",
    "score template with the slots swapped", "source without omitted", "subject without a local name",
    "trailing U+0085 is not JavaScript whitespace",
  ]);
  assert.equal(new Set(VECTORS.map((vector) => `${vector.file} ${vector.id}`)).size, VECTORS.length);
  // A dash in the fixture stays escaped, so the fixture itself has none.
  assert.doesNotMatch(readFileSync(PARITY_FIXTURE, "utf8"), /[\u2013\u2014]/u);
});
