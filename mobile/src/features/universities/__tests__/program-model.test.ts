// Подбор программ (G40): чистая модель. Правила те же, что у веба (program-facets.ts, ProgramList.tsx).
import { getPortalStrings } from "@web/lib/portal/i18n";
import { PROGRAMS_FIRST } from "@web/lib/portal/program-facets";
import type { UniversityContent } from "@web/lib/platform-university-catalog";

import { FILTER_FROM, monthName, NO_PICK, pickPrograms, programCountLabel, programOptions, programRows, programStarts } from "@/features/universities/program-model";
import { program, twelvePrograms } from "@/test-fixtures/programs";

const ru = getPortalStrings("universities", "ru");
const ky = getPortalStrings("universities", "ky");
const rows = programRows(twelvePrograms());
const content = { programs: twelvePrograms() } as unknown as UniversityContent;

describe("строки подбора", () => {
  it("признаки выводятся из названия по правилам веба: направление, месяцы, длительность", () => {
    const by = (id: string) => rows.find((row) => row.program.id === id)!;
    expect(by("cs-b").facets).toMatchObject({ field: "it", duration: "three" });
    expect(by("cs-b").facets.months).toEqual([2, 9]); // «Февраль / сентябрь» в подписи набора и дата начала
    expect(by("mba").facets).toMatchObject({ field: "business", duration: "short" }); // 1,5 года - меньше двух лет
    expect(by("civil-b").facets).toMatchObject({ field: "engineering", duration: "four" });
    expect(by("nurse-d").facets.field).toBe("medicine");
    expect(by("fdn").facets).toMatchObject({ field: "science", duration: "short" });
    expect(by("unknown-b").facets).toMatchObject({ field: "other", duration: null, months: [] });
  });

  it("поиск идёт по названию и описанию, одно слово или несколько", () => {
    const hit = (query: string) => pickPrograms(rows, query, NO_PICK, false, true).shown.map((row) => row.program.id);
    expect(hit("computer")).toEqual(["cs-b"]);
    expect(hit("master education")).toEqual(["edu-m"]);
    expect(hit("ОПИСАНИЕ ПРОГРАММЫ GRAPHIC")).toEqual(["design-b"]);
    expect(hit("zzz")).toEqual([]);
  });
});

describe("выдача", () => {
  it("без выбора - первые четыре; с выбором или запросом - все подходящие; после «Показать все» - все", () => {
    expect(PROGRAMS_FIRST).toBe(4);
    const idle = pickPrograms(rows, "", NO_PICK, false, true);
    expect(idle.active).toBe(false);
    expect(idle.shown).toHaveLength(12);
    expect(idle.visible.map((row) => row.program.id)).toEqual(rows.slice(0, 4).map((row) => row.program.id));
    expect(pickPrograms(rows, "", NO_PICK, true, true).visible).toHaveLength(12);
    const level = pickPrograms(rows, "", { ...NO_PICK, level: "master" }, false, true);
    expect(level.active).toBe(true);
    expect(level.visible.map((row) => row.program.id)).toEqual(["ai-m", "mba", "edu-m"]);
    expect(pickPrograms(rows, "bachelor", NO_PICK, false, true).visible.length).toBeGreaterThan(4);
  });

  it("без подбора (меньше четырёх программ) показываются все, FILTER_FROM как у веба", () => {
    expect(FILTER_FROM).toBe(4);
    const few = programRows([program({ id: "a", title: "Bachelor of Law" }), program({ id: "b", title: "Bachelor of Art" })]);
    expect(pickPrograms(few, "", NO_PICK, false, false).visible).toHaveLength(2);
  });

  it("неизвестные месяц и длительность программу не прячут", () => {
    const july = pickPrograms(rows, "", { ...NO_PICK, month: "7" }, false, true).shown.map((row) => row.program.id);
    expect(july).toEqual(expect.arrayContaining(["mba", "fdn", "unknown-b"]));
    expect(july).not.toContain("cs-b");
    const four = pickPrograms(rows, "", { ...NO_PICK, duration: "four" }, false, true).shown.map((row) => row.program.id);
    expect(four).toEqual(expect.arrayContaining(["civil-b", "law-b", "unknown-b"]));
    expect(four).not.toContain("mba");
  });

  it("число программ у варианта учитывает остальные поля и запрос, но не само поле", () => {
    const base = pickPrograms(rows, "", NO_PICK, false, true);
    expect(base.count("level", "bachelor")).toBe(rows.filter((row) => row.level === "bachelor").length);
    expect(base.count("level", "doctorate")).toBe(0);
    const masters = pickPrograms(rows, "", { ...NO_PICK, level: "master" }, false, true);
    // выбор уровня сужает число программ у направления, а у самого уровня остаётся полным
    expect(masters.count("field", "business")).toBe(1);
    expect(masters.count("field", "law")).toBe(0);
    expect(masters.count("level", "bachelor")).toBe(base.count("level", "bachelor"));
    const searched = pickPrograms(rows, "computer", NO_PICK, false, true);
    expect(searched.count("level", "bachelor")).toBe(1);
    expect(searched.count("level", "master")).toBe(0);
  });
});

describe("варианты полей", () => {
  it("уровни по шкале, направления и длительности в порядке словаря, месяцы по году с заглавной буквы", () => {
    const options = programOptions(rows, content, ru, "ru");
    expect(options.level.map((o) => o.value)).toEqual(["foundation", "diploma", "bachelor", "master"]);
    expect(options.level[2]).toEqual({ value: "bachelor", label: "Бакалавриат" });
    expect(options.field.map((o) => o.value)).toEqual(["it", "business", "engineering", "medicine", "law", "design", "education", "science", "hospitality", "other"]);
    expect(options.field[0]).toEqual({ value: "it", label: "IT и данные" });
    expect(options.duration.map((o) => o.value)).toEqual(["short", "two", "three", "four"]);
    expect(options.month.map((o) => o.value)).toEqual(["1", "2", "7", "9", "10"]);
    expect(options.month[2]?.label).toBe("Июль");
  });

  it("KY: подписи из общего словаря", () => {
    const options = programOptions(rows, content, ky, "ky");
    expect(options.level[2]?.label).toBe(ky["level.bachelor"]);
    expect(options.field[0]?.label).toBe(ky["programField.it"]);
  });
});

describe("подписи", () => {
  it("«N программ»: русские формы, у кыргызского одна", () => {
    expect(programCountLabel(1, ru, "ru")).toBe("1 программа");
    expect(programCountLabel(3, ru, "ru")).toBe("3 программы");
    expect(programCountLabel(64, ru, "ru")).toBe("64 программы");
    expect(programCountLabel(270, ru, "ru")).toBe("270 программ");
    expect(programCountLabel(11, ru, "ru")).toBe("11 программ");
    expect(programCountLabel(21, ru, "ru")).toBe("21 программа");
    expect(programCountLabel(5, ky, "ky")).toBe(ky["count.program.many"].replace("{count}", "5"));
  });

  it("начало: подписи наборов без повторов через «·»", () => {
    expect(programStarts(program({ id: "x", title: "Bachelor of Law", intakes: [{ label: "Февраль", n: 1 }, { label: "Июль", n: 2 }, { label: "Февраль", n: 3 }] }))).toBe("Февраль · Июль");
    expect(programStarts({ ...program({ id: "y", title: "Bachelor of Law" }), intakes: [] })).toBe("");
  });

  it("название месяца: язык без поддержки заменяется русским, без Intl вовсе - таблицей", () => {
    expect(monthName(7, "ru")).toBe("Июль");
    const supported = jest.spyOn(Intl.DateTimeFormat, "supportedLocalesOf").mockImplementation((tags) => (tags as string[]).filter((tag) => tag !== "ky"));
    expect(monthName(2, "ky")).toBe("Февраль");
    supported.mockImplementation(() => {
      throw new RangeError("no intl");
    });
    expect(monthName(12, "ky")).toBe("Декабрь");
    expect(monthName(5, "ru")).toBe("Май");
    supported.mockRestore();
  });
});
