import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { documentGuideView } from "@web/lib/portal/document-guides";
import { DOCUMENT_SAMPLE_SETS } from "@web/lib/portal/document-sample-sets";

import { currentSample, FIRST_PAGE, guideBlank, sampleFileName, sampleHeadingKey, sampleUrl } from "@/features/documents/guide-model";

const BASE = "https://app.evoadmissions.com";
const WEB_ROOT = path.resolve(__dirname, "../../../../..");

/** Шаблон исключения прокси для образцов из исходника веба (platform-route-contract.ts: модуль тянет серверные зависимости). */
function webSamplePattern(): RegExp {
  const source = readFileSync(path.join(WEB_ROOT, "src/lib/platform-route-contract.ts"), "utf8");
  const match = /const DOCUMENT_SAMPLE_FILE_PATH = \/(.+)\/;/.exec(source);
  if (!match) throw new Error("в вебе нет DOCUMENT_SAMPLE_FILE_PATH");
  return new RegExp(match[1]);
}

describe("адрес образца", () => {
  it("адрес портала + путь каталога: тот самый «https://app.evoadmissions.com/portal/document-samples/<файл>»", () => {
    expect(sampleUrl(BASE, "/portal/document-samples/passport-1.jpg")).toBe("https://app.evoadmissions.com/portal/document-samples/passport-1.jpg");
    expect(sampleUrl(BASE, "/portal/document-samples/passport-1-t.jpg")).toBe("https://app.evoadmissions.com/portal/document-samples/passport-1-t.jpg");
    expect(sampleUrl(BASE, "/portal/document-samples/medical-blank.pdf")).toBe("https://app.evoadmissions.com/portal/document-samples/medical-blank.pdf");
    // локальный стенд: тот же путь на адресе стенда
    expect(sampleUrl("http://localhost:3000", "/portal/document-samples/ielts-1.jpg")).toBe("http://localhost:3000/portal/document-samples/ielts-1.jpg");
  });

  it.each([
    ["чужой каталог", "/portal/documents"],
    ["вложенный путь", "/portal/document-samples/a/b.jpg"],
    ["выход вверх", "/portal/document-samples/../documents"],
    ["заглавные", "/portal/document-samples/Passport-1.jpg"],
    ["двойной дефис", "/portal/document-samples/passport--1.jpg"],
    ["не картинка", "/portal/document-samples/passport.html"],
    ["чужой хост в пути", "//evil.example/portal/document-samples/a.jpg"],
    ["полный адрес вместо пути", "https://evil.example/portal/document-samples/a.jpg"],
    ["пусто", ""],
  ])("путь не из каталога образцов отклоняется: %s", (_name, pathName) => {
    expect(sampleUrl(BASE, pathName)).toBeNull();
  });

  it.each(["", "app.evoadmissions.com", "ftp://app.evoadmissions.com", "https://app.evoadmissions.com/portal", "https://a b.test", "javascript:alert(1)"])("адрес портала не вида «схема://хост»: %j", (base) => {
    expect(sampleUrl(base, "/portal/document-samples/passport-1.jpg")).toBeNull();
  });

  it("шаблон пути совпадает с исключением прокси веба (ничего лишнего и ничего не потеряно)", () => {
    const web = webSamplePattern();
    const paths = [
      "/portal/document-samples/passport-1.jpg",
      "/portal/document-samples/passport-1-t.jpg",
      "/portal/document-samples/medical-blank.pdf",
      "/portal/document-samples/passport.svg",
      "/portal/document-samples/a1.png",
      "/portal/document-samples/diploma-1.webp",
      "/portal/document-samples/",
      "/portal/document-samples/Passport.svg",
      "/portal/document-samples/a/b.svg",
      "/portal/document-samples/passport.svg/",
      "/portal/document-samples/-passport.svg",
      "/portal/document-samples/passport--x.svg",
      "/document-samples/passport.svg",
    ];
    for (const item of paths) expect([item, sampleUrl(BASE, item) !== null]).toEqual([item, web.test(item)]);
  });

  it("каждая картинка и бланк каталога веба получает адрес, и такой файл есть в public/portal/document-samples", () => {
    let files = 0;
    for (const sets of Object.values(DOCUMENT_SAMPLE_SETS)) {
      for (const set of sets ?? []) {
        const names = [...set.pages.flatMap((page) => [page.file, page.file.replace(/\.jpg$/u, "-t.jpg")]), ...(set.download ? [set.download.file] : [])];
        for (const name of names) {
          expect(sampleUrl(BASE, `/portal/document-samples/${name}`)).toBe(`${BASE}/portal/document-samples/${name}`);
          expect([name, existsSync(path.join(WEB_ROOT, "public/portal/document-samples", name))]).toEqual([name, true]);
          files += 1;
        }
      }
    }
    expect(files).toBeGreaterThanOrEqual(70);
  });

  it("имя файла образца", () => {
    expect(sampleFileName("/portal/document-samples/medical-blank.pdf")).toBe("medical-blank.pdf");
  });
});

describe("курсор по наборам и страницам", () => {
  const attestat = documentGuideView({ requirementKey: "attestat", label: "" }, "ru", null)!;

  it("начало: первый набор, первая страница, их много", () => {
    const current = currentSample(attestat, FIRST_PAGE)!;
    expect([current.set.id, current.setIndex, current.pageIndex, current.many, current.set.pages.length]).toEqual(["attestat", 0, 0, true, 7]);
    expect(current.page.caption).toBe("Оригинал");
  });

  it("курсор за границей прижимается к краю (набор исчез или страниц стало меньше), как в вебе", () => {
    expect(currentSample(attestat, { set: 9, page: 99 })).toMatchObject({ setIndex: 2, pageIndex: 2, many: true });
    expect(currentSample(attestat, { set: 1, page: 99 })).toMatchObject({ setIndex: 1, pageIndex: 4 });
    expect(currentSample(attestat, { set: -3, page: -1 })).toMatchObject({ setIndex: 0, pageIndex: 0 });
    expect(currentSample(attestat, { set: Number.NaN, page: Number.POSITIVE_INFINITY })).toMatchObject({ setIndex: 0 });
  });

  it("нет образцов: null (будет нарисованная схема)", () => {
    const scheme = documentGuideView({ requirementKey: "application_form", label: "" }, "ru", null)!;
    expect(scheme.sampleSets).toEqual([]);
    expect(currentSample(scheme, FIRST_PAGE)).toBeNull();
    expect(currentSample({ sampleSets: [{ id: "x", label: "x", pages: [], download: null }] }, FIRST_PAGE)).toBeNull();
  });

  it("заголовок: «Пример» у одной страницы, «Примеры», когда есть из чего выбирать", () => {
    const passport = documentGuideView({ requirementKey: "passport", label: "" }, "ru", null)!;
    expect(sampleHeadingKey(passport, currentSample(passport, FIRST_PAGE)!)).toBe("guideSample");
    expect(sampleHeadingKey(attestat, currentSample(attestat, FIRST_PAGE)!)).toBe("guideSamples");
    const ielts = documentGuideView({ requirementKey: null, label: "Сертификат IELTS" }, "ru", "CN")!;
    expect(sampleHeadingKey(ielts, currentSample(ielts, FIRST_PAGE)!)).toBe("guideSample");
    const both = documentGuideView({ requirementKey: null, label: "Сертификат по языку (HSK, IELTS или TOEFL)" }, "ru", "CN")!;
    expect(sampleHeadingKey(both, currentSample(both, FIRST_PAGE)!)).toBe("guideSamples");
  });

  it("бланк: у медсправки Китая (при любом выбранном наборе), у Малайзии и общей справки его нет", () => {
    const cn = documentGuideView({ requirementKey: null, label: "Медицинская справка" }, "ru", "CN")!;
    expect(guideBlank(cn)).toEqual({ href: "/portal/document-samples/medical-blank.pdf", label: "Скачать бланк" });
    expect(documentGuideView({ requirementKey: null, label: "Медицинская справка" }, "ky", "CN")!.sampleSets.map((set) => set.label)).toEqual(["Бланк", "Толтуруунун үлгүсү"]);
    expect(guideBlank(documentGuideView({ requirementKey: null, label: "Медицинская справка" }, "ky", "CN")!)).toEqual({ href: "/portal/document-samples/medical-blank.pdf", label: "Бланкты жүктөп алуу" });
    expect(guideBlank(documentGuideView({ requirementKey: null, label: "Медицинская справка" }, "ru", "MY")!)).toBeNull();
    expect(guideBlank(documentGuideView({ requirementKey: null, label: "Медицинская справка" }, "ru", null)!)).toBeNull();
  });
});
