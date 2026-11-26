// Файлы строк срезов (`strings-*.ts`, Волна 0 паритета, 25.11.2026). Срезы идут параллельно и правят каждый свой файл, поэтому
// договор между файлами проверяется здесь, а не вниманием ревьюера: каждый файл подключён в mobile-strings.ts, в паре RU и KY
// ключи одни и те же, ни один ключ не лежит в двух файлах (при слиянии спредов второй молча затёр бы первый).
// Файлы находятся по имени `strings-*.ts`: новый файл среза проверяется сам, список здесь править не нужно.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { MOBILE_STRINGS } from "@/i18n/mobile-strings";
import { PENDING_OWNER_KEYS } from "@/i18n/strings-documents";

const DIR = path.join(__dirname, "..");
const files = readdirSync(DIR)
  .filter((name) => /^strings-[a-z0-9-]+\.ts$/.test(name))
  .sort();
const mainSource = readFileSync(path.join(DIR, "mobile-strings.ts"), "utf8");

/** Файлы, которые перечислены в таблице владельцев (docs/mobile/PLAN.md, «Волна 0 паритета»): их не удаляют и не переименовывают. */
const OWNED = [
  "strings-app.ts",
  "strings-consultation.ts",
  "strings-documents.ts",
  "strings-home.ts",
  "strings-inbox.ts",
  "strings-learning-2.ts",
  "strings-learning.ts",
  "strings-payments.ts",
  "strings-preparations.ts",
  "strings-profile.ts",
  "strings-registration.ts",
  "strings-shell.ts",
  "strings-universities.ts",
];

type Fragment = { ruName: string; kyName: string; ru: Record<string, string>; ky: Record<string, string> };

function load(file: string): Fragment {
  const exported = jest.requireActual<Record<string, unknown>>(path.join(DIR, file));
  const ruNames = Object.keys(exported).filter((name) => /^[A-Z0-9]+_RU$/.test(name));
  const kyNames = Object.keys(exported).filter((name) => /^[A-Z0-9]+_KY$/.test(name));
  expect([file, ruNames.length, kyNames.length]).toEqual([file, 1, 1]);
  expect([file, ruNames[0].replace(/_RU$/, "")]).toEqual([file, kyNames[0].replace(/_KY$/, "")]);
  return { ruName: ruNames[0], kyName: kyNames[0], ru: exported[ruNames[0]] as Record<string, string>, ky: exported[kyNames[0]] as Record<string, string> };
}

const fragments = new Map(files.map((file) => [file, load(file)]));

describe("файлы строк срезов", () => {
  it("все файлы из таблицы владельцев на месте", () => {
    expect(files).toEqual(expect.arrayContaining(OWNED));
  });

  describe.each(files)("%s", (file) => {
    const fragment = fragments.get(file)!;

    it("в паре RU и KY одни и те же ключи, строки не пусты", () => {
      expect(Object.keys(fragment.ky).sort()).toEqual(Object.keys(fragment.ru).sort());
      for (const lang of ["ru", "ky"] as const) {
        for (const [key, value] of Object.entries(fragment[lang])) {
          expect([file, lang, key, typeof value === "string" && (value.trim().length > 0 || PENDING_OWNER_KEYS.includes(key))]).toEqual([file, lang, key, true]);
        }
      }
    });

    it("подключён в mobile-strings.ts: один импорт и по одному спреду в RU и в KY", () => {
      const module = file.replace(/\.ts$/, "");
      const importPattern = new RegExp(`import \\{[^}]*\\b${fragment.ruName}\\b[^}]*\\} from "@/i18n/${module}";`);
      expect([file, importPattern.test(mainSource)]).toEqual([file, true]);
      for (const name of [fragment.ruName, fragment.kyName]) {
        const spreads = mainSource.match(new RegExp(`^\\s*\\.\\.\\.${name},\\s*$`, "gm")) ?? [];
        expect([file, name, spreads.length]).toEqual([file, name, 1]);
      }
    });

    it("строки файла доходят до общего словаря без изменений", () => {
      for (const [key, value] of Object.entries(fragment.ru)) expect([key, MOBILE_STRINGS.ru[key as keyof typeof MOBILE_STRINGS.ru]]).toEqual([key, value]);
      for (const [key, value] of Object.entries(fragment.ky)) expect([key, MOBILE_STRINGS.ky[key as keyof typeof MOBILE_STRINGS.ky]]).toEqual([key, value]);
    });

    it("в шапке записано соглашение о KY: новая строка получает пометку «KY: needs native proofreading»", () => {
      const header = readFileSync(path.join(DIR, file), "utf8").split("\n").slice(0, 12).join("\n");
      expect([file, /KY: needs native proofreading/.test(header)]).toEqual([file, true]);
    });
  });

  it("ни один ключ не лежит в двух файлах срезов", () => {
    const owners = new Map<string, string[]>();
    for (const [file, fragment] of fragments) {
      for (const key of Object.keys(fragment.ru)) owners.set(key, [...(owners.get(key) ?? []), file]);
    }
    const repeated = [...owners].filter(([, where]) => where.length > 1);
    expect(repeated).toEqual([]);
  });

  it("шапка mobile-strings.ts хранит то же соглашение о KY", () => {
    expect(mainSource.split("\n").slice(0, 12).join("\n")).toMatch(/каждая новая KY-строка получает в конце пометку `\/\/ KY: needs native proofreading`/);
  });
});
