import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// PORT-3a: гео-библиотека каталога — repo-JSON по ключу photoKey с
// провенансом на каждую запись (docs/PLAN_CHANGES.md, запись PORT-3a).
// Вуз без записи здесь не получает точку на карте; фиктивные координаты
// запрещены планом, поэтому схема и диапазоны проверяются жёстко.

const read = (path) =>
  JSON.parse(readFileSync(new URL(`../src/lib/${path}`, import.meta.url), "utf8"));

const geo = read("university-geo-library.json");
const photos = read("university-photo-library.json");

test("every geo entry is exactly {lat, lng, sourceUrl, verifiedOn} in valid ranges", () => {
  const entries = Object.entries(geo);
  assert.ok(entries.length > 0);
  for (const [key, entry] of entries) {
    assert.deepEqual(
      Object.keys(entry).sort(),
      ["lat", "lng", "sourceUrl", "verifiedOn"],
      key,
    );
    assert.ok(Number.isFinite(entry.lat) && entry.lat >= -90 && entry.lat <= 90, key);
    assert.ok(Number.isFinite(entry.lng) && entry.lng >= -180 && entry.lng <= 180, key);
    // «Нулевой остров» — типичный след пустого геокодера, не кампус.
    assert.ok(entry.lat !== 0 || entry.lng !== 0, key);
    assert.equal(typeof entry.sourceUrl, "string", key);
    assert.ok(entry.sourceUrl.startsWith("https://"), key);
    assert.match(entry.verifiedOn, /^\d{4}-\d{2}-\d{2}$/u, key);
    assert.ok(!Number.isNaN(Date.parse(entry.verifiedOn)), key);
  }
});

test("every geo key belongs to the photo library key set", () => {
  const photoKeys = new Set(Object.keys(photos));
  for (const key of Object.keys(geo)) {
    assert.ok(photoKeys.has(key), `unknown photoKey: ${key}`);
  }
});

test("no duplicate keys or duplicate exact points", () => {
  // JSON.parse молча схлопнул бы дублирующийся ключ — ловим по исходному тексту.
  const source = readFileSync(
    new URL("../src/lib/university-geo-library.json", import.meta.url),
    "utf8",
  );
  const keyMatches = [...source.matchAll(/^ {2}"([^"]+)": \{/gmu)].map((match) => match[1]);
  assert.equal(keyMatches.length, Object.keys(geo).length);
  assert.equal(new Set(keyMatches).size, keyMatches.length);

  const seen = new Map();
  for (const [key, entry] of Object.entries(geo)) {
    const point = `${entry.lat},${entry.lng}`;
    assert.ok(!seen.has(point), `${key} shares the exact point of ${seen.get(point)}`);
    seen.set(point, key);
  }
});
