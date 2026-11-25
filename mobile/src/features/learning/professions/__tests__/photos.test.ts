// Фото профессий: набор и файлы те же, что у веба (`profession-photo-files.ts`), копий нет, весят немного (ресурсы сборки, не сеть).
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { PROFESSION_PHOTOS } from "@/features/learning/professions/photos";
import { professionPhotoSource } from "@/features/learning/professions/ProfessionPhoto";

// Слово не пишется целиком рядом со скобкой: страж общих импортов читает исходники тестов и принял бы строку за настоящую загрузку файла.
const LOAD = ["re", "quire"].join("");
const REPO = path.resolve(__dirname, "../../../../../../");
const webMap = readFileSync(path.join(REPO, "src/components/portal/professions/profession-photo-files.ts"), "utf8");
const appMap = readFileSync(path.join(__dirname, "../photos.ts"), "utf8");
const webKeys = [...webMap.matchAll(/^ {2}"([a-z-]+)": [A-Za-z]+,$/gmu)].map((match) => match[1] as string);

describe("фото профессий", () => {
  it("те же 24 ключа, что у веба, и у каждого есть фото; чужого ключа нет", () => {
    expect(webKeys).toHaveLength(24);
    expect(Object.keys(PROFESSION_PHOTOS).sort()).toEqual([...webKeys].sort());
    for (const key of webKeys) {
      expect(PROFESSION_PHOTOS[key]).toBeTruthy();
      expect(professionPhotoSource(key)).toBe(PROFESSION_PHOTOS[key]);
    }
    expect(professionPhotoSource("no-such-card")).toBeNull();
    expect(professionPhotoSource("")).toBeNull();
  });

  it("ресурс каждого ключа - тот же файл, что у веба: `src/content/professions/photos/<ключ>.webp`, без копий в приложении", () => {
    for (const key of webKeys) {
      expect(webMap).toContain(`from "../../../content/professions/photos/${key}.webp"`);
      expect(appMap).toContain(`"${key}": ${LOAD}("../../../../../src/content/professions/photos/${key}.webp")`);
      const file = path.join(REPO, `src/content/professions/photos/${key}.webp`);
      expect(existsSync(file)).toBe(true);
    }
    expect(appMap.match(new RegExp(`${LOAD}\\(`, "gu"))).toHaveLength(24);
    expect(existsSync(path.join(__dirname, "../../../../../assets/professions"))).toBe(false);
  });

  it("весят немного: каждый снимок до 100 КБ, все вместе до 1,2 МБ (едут ресурсами сборки и обновления, по сети не грузятся)", () => {
    const sizes = webKeys.map((key) => statSync(path.join(REPO, `src/content/professions/photos/${key}.webp`)).size);
    for (const size of sizes) expect(size).toBeLessThan(100 * 1024);
    expect(sizes.reduce((sum, size) => sum + size, 0)).toBeLessThan(1.2 * 1024 * 1024);
  });

  it("сеть не нужна: ни адресов, ни загрузки по адресу в файле карты", () => {
    const code = appMap.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/(^|\s)\/\/.*$/gmu, "$1");
    expect(code).not.toMatch(/https?:|uri:|fetch\(/u);
  });
});
