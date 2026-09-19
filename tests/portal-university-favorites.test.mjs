import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  FAVORITES_BY_IDS_CAP,
  chunkInstitutionIds,
  parseFavoriteReceipt,
  parseUniversityFavorites,
} from "../src/lib/portal/university-favorites.ts";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const FAVORITE = {
  institutionId: "19500000-0000-4000-8000-000000000601",
  createdAt: "2026-09-19T10:00:00.000+00:00",
};
const OTHER_ID = "19500000-0000-4000-8000-000000000602";

// PORT-3b: разбор ответа student_university_favorites_v1 строгий — форма
// с сервера либо принимается целиком, либо честно отклоняется (null), без
// тихо укороченного списка.
test("favourites payload parses strictly and fails closed on any drift", () => {
  assert.deepEqual(parseUniversityFavorites([]), []);
  assert.deepEqual(
    parseUniversityFavorites([FAVORITE, { ...FAVORITE, institutionId: OTHER_ID }]),
    [FAVORITE, { ...FAVORITE, institutionId: OTHER_ID }],
  );

  for (const broken of [
    null,
    {},
    "[]",
    [null],
    [[FAVORITE.institutionId, FAVORITE.createdAt]],
    [{ institutionId: FAVORITE.institutionId }],
    [{ ...FAVORITE, extra: true }],
    [{ ...FAVORITE, institutionId: "not-a-uuid" }],
    [{ ...FAVORITE, createdAt: "2026-09-19" }],
    [{ ...FAVORITE, createdAt: "2026-99-99T00:00:00Z" }],
    [FAVORITE, FAVORITE],
  ]) {
    assert.equal(parseUniversityFavorites(broken), null, JSON.stringify(broken));
  }
});

// Серверный потолок by_ids — 30 id за вызов (миграция 195): больший набор
// избранного читается последовательными кусками без потери порядка.
test("institution ids are chunked to the server-side by_ids cap", () => {
  assert.equal(FAVORITES_BY_IDS_CAP, 30);
  assert.deepEqual(chunkInstitutionIds([]), []);
  const ids = Array.from({ length: 31 }, (_, index) => `id-${index}`);
  const chunks = chunkInstitutionIds(ids);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].length, 30);
  assert.deepEqual(chunks[1], ["id-30"]);
  assert.deepEqual(chunks.flat(), ids);
  assert.throws(() => chunkInstitutionIds(ids, 0), /positive/u);
});

test("favourite receipts resolve to an honest action result", () => {
  assert.deepEqual(
    parseFavoriteReceipt({
      institutionId: FAVORITE.institutionId,
      favored: true,
      favoritesCount: 1,
    }),
    { ok: true, favored: true },
  );
  for (const broken of [
    null,
    [],
    { favored: true },
    { institutionId: FAVORITE.institutionId },
    { institutionId: "not-a-uuid", favored: true },
    { institutionId: FAVORITE.institutionId, favored: "true" },
  ]) {
    assert.deepEqual(parseFavoriteReceipt(broken), { ok: false }, JSON.stringify(broken));
  }
});

// Структурные пины PORT-3b: раздел «Избранное» виден обоим tier'ам, toggle
// подключён к карточкам каталога и карточке вуза, а действие — настоящий
// server action со строгой валидацией входа.
test("favorites section, toggle wiring and server action stay in place", () => {
  const shell = source("src/components/portal/Shell.tsx");
  assert.match(
    shell,
    /\{ href: "\/portal\/favorites", key: "nav\.favorites", tiers: \["approved", "assisted"\] \}/u,
  );

  const catalog = source("src/components/portal/universities/Catalog.tsx");
  const detail = source("src/components/portal/universities/Detail.tsx");
  for (const surface of [catalog, detail]) {
    assert.match(surface, /<FavoriteToggle/u);
  }

  const actions = source("src/lib/portal/university-favorites-actions.ts");
  assert.match(actions, /^"use server";/u);
  assert.match(actions, /requireStudentPortalActor\(\)/u);
  assert.match(actions, /universityUuid\(institutionId\)/u);
  assert.match(actions, /set_university_favorite_v1/u);

  const toggle = source("src/components/portal/universities/FavoriteToggle.tsx");
  assert.match(toggle, /aria-pressed=\{favored\}/u);
  assert.match(toggle, /setFavored\(previous\)/u, "failed server write must revert the optimistic state");
  assert.match(toggle, /role="alert"/u);
});

// План §6/§14: сравнение — фактические свойства, без рейтингов и «шансов».
// Проверяются видимые пользователю строки словаря, а не комментарии кода.
test("comparison stays factual: no ratings or admission-chance vocabulary", async () => {
  const { PORTAL_DICTIONARIES } = await import("../src/lib/portal/i18n.ts");
  for (const namespace of ["favorites", "universities"]) {
    for (const locale of ["ru", "ky"]) {
      for (const [key, value] of Object.entries(PORTAL_DICTIONARIES[namespace][locale])) {
        assert.doesNotMatch(value, /рейтинг|шанс|rating|chance/iu, `${namespace}.${key} (${locale})`);
      }
    }
  }
  const view = source("src/components/portal/favorites/FavoritesView.tsx");
  for (const row of ["compareCountry", "compareLevels", "comparePrograms", "compareIntake"]) {
    assert.match(view, new RegExp(`strings\\.${row}`, "u"));
  }
});
