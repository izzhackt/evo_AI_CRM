import { strict as assert } from "node:assert";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

// Quiet-interface sweep (Other staff-UX plan, OTH-0, 2026-09-19): these
// explanatory paragraphs narrated the system instead of helping a decision
// (DESIGN.md «Тихий интерфейс»). They were removed from the staff UI and must
// not come back. Error text, empty states, permission and consequence notices
// stay allowed — this list pins only the removed narration.
const REMOVED_PHRASES = [
  "не добавляет продажу в отчёт",
  "Сумма продажи и полученная оплата — разные факты",
  "Кнопки направлений выше только фильтруют список",
  "не делает её автоматически оплаченной",
  "Утверждённая идентичность вуза сохраняется",
  "В карточке показываются описания, программы и известные даты",
  "Проверьте подготовленные карточки по ссылкам ниже",
  "Сначала сохраните сведения на проверку",
  "«В работе» и ожидания — состояние сейчас",
  "Это отчётная запись, а не подтверждение платежа",
  "Откройте переписку из списка слева",
];

const SCAN_ROOTS = ["src/components/v3", "src/app/(v3)"];
const SKIP_DIRECTORIES = new Set(["portal"]);

function collectSourceFiles(root) {
  const files = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) {
      if (!SKIP_DIRECTORIES.has(entry)) files.push(...collectSourceFiles(path));
      continue;
    }
    if (/\.(tsx|ts)$/u.test(entry)) files.push(path);
  }
  return files;
}

test("removed explanatory narration does not reappear in the staff UI", () => {
  const files = SCAN_ROOTS.flatMap((root) => collectSourceFiles(root));
  assert.ok(files.length > 100, `expected a real source tree, found ${files.length} files`);
  const violations = [];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const phrase of REMOVED_PHRASES) {
      if (source.includes(phrase)) violations.push(`${file}: «${phrase}»`);
    }
  }
  assert.deepEqual(violations, []);
});
