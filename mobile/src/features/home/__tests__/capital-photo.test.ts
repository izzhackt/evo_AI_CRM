// Фото столицы в шапке «Главной»: выбор фото тот же, что у веба (`capitalPhoto`, university-tiles.ts), а таблица
// столиц совпадает с веб-файлом по тексту (веб-модуль начинается с `import "server-only"`, импортировать его нельзя).
import { readFileSync } from "node:fs";
import path from "node:path";

import { decodeIndexBody } from "@/features/universities/api";
import { CAPITAL_CITY, capitalGeographyPhoto } from "@/features/home/capital-photo";
import { cityRow, geoPhoto, indexBody, uniRow } from "@/test-fixtures/university-index";

const WEB_FILE = path.resolve(__dirname, "../../../../../src/lib/portal/university-tiles.ts");

type Body = ReturnType<typeof indexBody>;

function index(edit: (body: Body) => void = () => undefined) {
  const body = indexBody();
  edit(body);
  const decoded = decodeIndexBody(body);
  if (decoded === null) throw new Error("fixture index must decode");
  return decoded;
}

describe("таблица столиц", () => {
  it("совпадает с таблицей веба (university-tiles.ts, CAPITAL_CITY)", () => {
    const source = readFileSync(WEB_FILE, "utf8");
    const block = /const CAPITAL_CITY[^=]*=\s*\{([^}]*)\}/u.exec(source);
    expect(block).not.toBeNull();
    const web = Object.fromEntries([...block![1].matchAll(/([A-Z]{2}):\s*"([a-z-]+)"/gu)].map((match) => [match[1], match[2]]));
    expect(Object.keys(web)).toHaveLength(6);
    expect(CAPITAL_CITY).toEqual(web);
  });
});

describe("фото шапки для страны", () => {
  it("фото города-столицы важнее фото страны", () => {
    const photo = capitalGeographyPhoto(index(), "MY");
    expect(photo?.path).toBe("geography/cities/kuala-lumpur-0123456789ab.jpg");
  });

  it("нет столицы в каталоге (ОАЭ, Абу-Даби): фото страны", () => {
    const withCountryPhoto = index((body) => {
      body.countries.find((country) => country.code === "AE")!.photo = geoPhoto("countries", "uae") as never;
    });
    expect(capitalGeographyPhoto(withCountryPhoto, "AE")?.path).toBe("geography/countries/uae-0123456789ab.jpg");
  });

  it("столица добавлена в каталог - берётся её фото, а не фото страны", () => {
    const withBeijing = index((body) => {
      // Город без вузов выдача отбрасывает (как и на вебе), поэтому у столицы есть вуз.
      body.cities.push(cityRow("beijing", "CN", "Пекин", "Бээжин", 1));
      body.universities.push(uniRow(9, "Университет Пекина", "CN", { cityKey: "beijing" }));
      body.countries.find((country) => country.code === "CN")!.photo = geoPhoto("countries", "china") as never;
    });
    expect(capitalGeographyPhoto(withBeijing, "CN")?.path).toBe("geography/cities/beijing-0123456789ab.jpg");
  });

  it("нет ни столицы, ни фото страны: фото нет, шапка остаётся тёмной плашкой", () => {
    expect(capitalGeographyPhoto(index(), "CN")).toBeNull();
    expect(capitalGeographyPhoto(index(), "TR")).toBeNull();
  });

  it("чужой город той же столицы в другой стране не подходит", () => {
    const foreign = index((body) => {
      body.cities.push(cityRow("beijing", "MY", "Пекин", "Бээжин", 1));
      body.universities.push(uniRow(9, "Колледж Пекин", "MY", { cityKey: "beijing" }));
    });
    expect(capitalGeographyPhoto(foreign, "CN")).toBeNull();
  });

  it("«Пока не решил», страна вне шести, пустая страна и непрочитанный индекс: фото нет", () => {
    expect(capitalGeographyPhoto(index(), "UNDECIDED")).toBeNull();
    expect(capitalGeographyPhoto(index(), "FR")).toBeNull();
    expect(capitalGeographyPhoto(index(), null)).toBeNull();
    expect(capitalGeographyPhoto(null, "MY")).toBeNull();
  });
});
