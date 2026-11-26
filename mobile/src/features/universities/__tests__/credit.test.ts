// Подпись фото: части строки со ссылками и проверка адреса (G41). Данные настоящие: библиотека фото вузов и разборщик индекса.
import { catalogUrl } from "@web/lib/catalog-text";
import { UNIVERSITY_PHOTOS } from "@web/lib/platform-university-catalog";
import { getPortalStrings } from "@web/lib/portal/i18n";
import { parseStudentUniversityIndexResponse } from "@web/lib/portal/university-index";

import { creditLine, creditSegments, creditSourceUrl, safeHttpsUrl } from "@/features/universities/credit";
import { geographyPhotoCredit, universityPhotoCaption, universityPhotoCredit, type PhotoCreditView } from "@/features/universities/photos";
import { indexBody } from "@/test-fixtures/university-index";

const ru = getPortalStrings("universities", "ru");
const ky = getPortalStrings("universities", "ky");

describe("адрес перед открытием", () => {
  it("только https, без логина, пробелов и управляющих знаков", () => {
    expect(safeHttpsUrl("https://commons.wikimedia.org/wiki/File:Test.jpg")).toBe("https://commons.wikimedia.org/wiki/File:Test.jpg");
    expect(safeHttpsUrl("https://library.csuft.edu.cn:443/")).toBe("https://library.csuft.edu.cn:443/");
    for (const bad of ["http://example.org/", "javascript:alert(1)", "file:///etc/passwd", "evoadmissions://x", "//example.org", "https://user:pw@example.org/", "https://exa mple.org/", "https://example.org/\u0007", "https://", " https://example.org/", "https://example.org/a\\b", "", null, undefined, 5]) {
      expect([bad, safeHttpsUrl(bad)]).toEqual([bad, null]);
    }
  });

  it("все ссылки библиотеки фото вузов годятся", () => {
    // Библиотека - настоящий список из репозитория: испорченная запись здесь же и обнаружится.
    const entries = ["sunway", "apu", "xjtlu", "central-south-university-of-forestry-and-technology"];
    for (const key of entries) {
      const credit = universityPhotoCredit(key);
      expect(credit).not.toBeNull();
      expect(safeHttpsUrl(credit?.sourceUrl)).not.toBeNull();
    }
  });
});

describe("проверка адреса мягче `catalogUrl` намеренно", () => {
  it("настоящий адрес источника с явным портом правило каталога отвергает, а подпись его открывает", () => {
    const url = "https://library.csuft.edu.cn:443/";
    expect(catalogUrl(url)).toBe(false);
    expect(safeHttpsUrl(url)).toBe(url);
    const official = universityPhotoCredit("central-south-university-of-forestry-and-technology");
    expect(official).toMatchObject({ kind: "official", sourceUrl: url });
    expect(creditSegments(official as PhotoCreditView, ru, "Университет").find((segment) => segment.text === "Университет")?.url).toBe(url);
  });

  it("все адреса источников и лицензий библиотеки проходят проверку: подпись не теряет ссылку из-за неё", () => {
    for (const [key, entry] of Object.entries(UNIVERSITY_PHOTOS)) {
      for (const url of [entry.sourceUrl, entry.licenseUrl]) {
        if (url === null || url === undefined) continue;
        expect([key, safeHttpsUrl(url)]).toEqual([key, url]);
      }
    }
  });
});

describe("ссылка на всю строку подписи (шапка «Главной»)", () => {
  const parsed = parseStudentUniversityIndexResponse(indexBody());
  if (!parsed || parsed.notModified) throw new Error("fixture");
  const place = geographyPhotoCredit(parsed.index.cities.find((city) => city.key === "penang")!.photo);

  it("безопасный адрес источника; у фото мест хост должен принадлежать названному источнику", () => {
    expect(creditSourceUrl(place)).toBe("https://commons.wikimedia.org/wiki/File:Test.jpg");
    for (const sourceUrl of [
      "javascript:alert(1)",
      "http://commons.wikimedia.org/wiki/File:Test.jpg",
      "https://commons.wikimedia.org.evil.example/wiki/File:Test.jpg",
      "https://evil.example/wiki/File:Test.jpg",
      "https://user:pw@commons.wikimedia.org/wiki/File:Test.jpg",
      "https://commons.wikimedia.org/wiki/File: Test.jpg",
    ]) {
      expect([sourceUrl, creditSourceUrl({ ...(place as Extract<PhotoCreditView, { kind: "author" }>), sourceUrl })]).toEqual([sourceUrl, null]);
    }
  });

  it("официальный адрес и фото вуза без названного источника: достаточно безопасного адреса", () => {
    expect(creditSourceUrl({ kind: "official", sourceUrl: "https://example.org/" })).toBe("https://example.org/");
    expect(creditSourceUrl({ kind: "official", sourceUrl: "javascript:alert(1)" })).toBeNull();
    expect(creditSourceUrl(universityPhotoCredit("sunway") as PhotoCreditView)).toBe("https://commons.wikimedia.org/wiki/File:Cmglee_Sunway_University_new_building.jpg");
  });
});

describe("подпись фото вуза", () => {
  it("открытая лицензия: «Фото: автор, лицензия», автор ведёт на страницу источника, лицензия на свой текст", () => {
    const credit = universityPhotoCredit("sunway");
    expect(credit).toMatchObject({ kind: "author", license: "CC BY-SA 4.0", sourceName: null });
    const segments = creditSegments(credit as PhotoCreditView, ru);
    expect(segments.map((s) => s.text).join("")).toBe("Фото: Cmglee, CC BY-SA 4.0");
    expect(segments.find((s) => s.text === "Cmglee")?.url).toBe("https://commons.wikimedia.org/wiki/File:Cmglee_Sunway_University_new_building.jpg");
    expect(segments.find((s) => s.text === "CC BY-SA 4.0")?.url).toBe("https://creativecommons.org/licenses/by-sa/4.0/");
  });

  it("официальный сайт вуза: «Фото: <вуз>, официальный сайт», название вуза - ссылка на источник; KY из общего словаря", () => {
    const credit = universityPhotoCredit("xjtlu");
    expect(credit).toMatchObject({ kind: "official" });
    const official = creditSegments(credit as PhotoCreditView, ru, "Тестовый университет");
    expect(official.map((s) => s.text).join("")).toBe("Фото: Тестовый университет, официальный сайт");
    expect(official.find((s) => s.text === "Тестовый университет")?.url).toMatch(/^https:\/\//);
    expect(creditLine(credit as PhotoCreditView, ky, "Тест")).toBe("Сүрөт: Тест, расмий сайт");
  });

  it("описание фото вуза берётся из библиотеки (веб: alt = caption)", () => {
    expect(universityPhotoCaption("sunway")).toBe("Корпус кампуса Sunway University");
    expect(universityPhotoCaption("нет-такого")).toBeNull();
    expect(universityPhotoCaption(null)).toBeNull();
  });
});

describe("подпись фото места", () => {
  const parsed = parseStudentUniversityIndexResponse(indexBody());
  if (!parsed || parsed.notModified) throw new Error("fixture");
  const photo = parsed.index.cities.find((city) => city.key === "penang")!.photo;

  it("«Фото: автор, источник, лицензия»: источник ведёт на страницу файла, лицензия без адреса - просто текст", () => {
    const segments = creditSegments(geographyPhotoCredit(photo), ru);
    expect(segments.map((s) => s.text).join("")).toBe("Фото: Автор Тестов, Wikimedia Commons, CC BY 4.0");
    expect(segments.find((s) => s.text === "Wikimedia Commons")?.url).toBe("https://commons.wikimedia.org/wiki/File:Test.jpg");
    expect(segments.find((s) => s.text === "CC BY 4.0")?.url).toBeNull();
    expect(segments.find((s) => s.text === "Автор Тестов")?.url).toBeNull();
  });

  it("адрес автора и лицензии открываются, если они есть", () => {
    const credit = geographyPhotoCredit({ ...photo, authorUrl: "https://commons.wikimedia.org/wiki/User:Autor", licenseUrl: "https://creativecommons.org/licenses/by/4.0/" });
    const segments = creditSegments(credit, ru);
    expect(segments.find((s) => s.text === "Автор Тестов")?.url).toBe("https://commons.wikimedia.org/wiki/User:Autor");
    expect(segments.find((s) => s.text === "CC BY 4.0")?.url).toBe("https://creativecommons.org/licenses/by/4.0/");
  });

  it("источник, чей хост не принадлежит названному сервису, показывается текстом без ссылки", () => {
    const credit = geographyPhotoCredit({ ...photo, sourceUrl: "https://evil.example.com/wiki/File:Test.jpg" });
    expect(creditSegments(credit, ru).find((s) => s.text === "Wikimedia Commons")?.url).toBeNull();
    // и подмена схемы не открывается
    const scheme = geographyPhotoCredit({ ...photo, authorUrl: "javascript:alert(1)", licenseUrl: "http://creativecommons.org/licenses/by/4.0/" });
    const segments = creditSegments(scheme, ru);
    expect(segments.find((s) => s.text === "Автор Тестов")?.url).toBeNull();
    expect(segments.find((s) => s.text === "CC BY 4.0")?.url).toBeNull();
  });

  it("прежняя подпись без authorUrl (сборка старым кодом) остаётся годной", () => {
    const old: PhotoCreditView = { kind: "author", author: "А", license: "CC0", licenseUrl: null, sourceUrl: "https://commons.wikimedia.org/wiki/File:A.jpg", sourceName: "Wikimedia Commons" };
    expect(creditLine(old, ru)).toBe("Фото: А, Wikimedia Commons, CC0");
  });
});
