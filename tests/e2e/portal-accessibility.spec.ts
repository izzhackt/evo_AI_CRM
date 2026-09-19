import { execFileSync } from "node:child_process";
import { join } from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Портальный a11y-гейт (PORT-6a): axe-core по СТАТИЧЕСКОМУ рендеру реальных
 * компонентов новых портальных экранов с настоящим portal.css — та же связка
 * AxeBuilder + WCAG-теги, что в staff-гейте
 * tests/e2e/platform-accessibility.spec.ts, но без живого Supabase-runtime
 * (данные — репрезентативные фикстуры E2-типов). Живой рендер остаётся за
 * E5-гейтом; поведение фокуса/live-областей после асинхронных действий
 * статический рендер не проверяет.
 *
 * Рендер выполняет tests/e2e/portal-static-render.cjs в ОТДЕЛЬНОМ
 * node-процессе: транспилер Playwright компилирует JSX компонентов в
 * CT-дескрипторы ({__pw_type}), а не в React-элементы, поэтому рендерить
 * настоящие компоненты внутри спеки нельзя.
 */

const WCAG_TAGS = [
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
  "wcag22aa",
] as const;

type Surface = Readonly<{ name: string; html: string }>;

// Playwright компилирует спеки в CJS — __dirname доступен.
const surfaces: readonly Surface[] = JSON.parse(
  execFileSync(process.execPath, [join(__dirname, "portal-static-render.cjs")], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }),
);

const EXPECTED_SURFACES = [
  "admission-overview",
  "admission-documents",
  "admission-notifications",
  // PORT-8c: экраны тестов в «Атласе» — каталог, раннер и результаты.
  "tests-catalog",
  "tests-runner",
  "tests-results",
  "professions-and-profile-forms",
  // PORT-9c: «Главная» кабинета — оба tier'а.
  "home-approved",
  "home-assisted",
] as const;

test("static render produces every expected portal surface", () => {
  expect(surfaces.map((surface) => surface.name)).toEqual([...EXPECTED_SURFACES]);
  for (const surface of surfaces) {
    expect(surface.html).toContain("<main");
    expect(surface.html).toContain("<h1");
  }
});

for (const name of EXPECTED_SURFACES) {
  for (const colorScheme of ["light", "dark"] as const) {
    test(`portal surface ${name} has no WCAG violations (${colorScheme})`, async ({ page }) => {
      const surface = surfaces.find((candidate) => candidate.name === name);
      if (!surface) throw new Error(`missing surface ${name}`);
      await page.emulateMedia({ colorScheme });
      await page.setContent(surface.html, { waitUntil: "domcontentloaded" });
      const results = await new AxeBuilder({ page })
        .withTags([...WCAG_TAGS])
        .analyze();
      expect(results.violations).toEqual([]);
    });
  }
}
