import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { SPEECH_COMMANDS, formulasIn, speakMathText, speakTex } from "@/features/learning/math/speak";
import { parseMathJaxSvg, typesetTex } from "@/features/learning/math/mathjax-svg";
import { splitMathText } from "@web/lib/portal/csca";

const DIR = path.join(__dirname, "../../../test-fixtures/csca");
/** Весь выпуск контента математики CSCA (28 файлов уроков, 228 заданий, формы, темы): то, что студент увидит в приложении. */
const CONTENT_DIR = path.join(__dirname, "../../../../../docs/design/portal/content/csca/math");

/** Все `.json` каталога и вложенных каталогов, по имени. */
function jsonFiles(dir: string): string[] {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) return jsonFiles(full);
      return name.endsWith(".json") ? [full] : [];
    });
}

/** Обход значений файла: строка под ключом `tex` целиком формула, остальные строки режутся по `$`; рисунки (`svg`) пропускаются. */
function walkStrings(value: unknown, key: string | null, visit: (text: string, key: string | null) => void): void {
  if (Array.isArray(value)) value.forEach((v) => walkStrings(v, key, visit));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) if (k !== "svg") walkStrings(v, k, visit);
  } else if (typeof value === "string") visit(value, key);
}

function formulasOf(file: string, found: Set<string>): void {
  walkStrings(JSON.parse(readFileSync(file, "utf8")), null, (text, key) => {
    if (key === "tex") found.add(text);
    else formulasIn(text).forEach((f) => found.add(f));
  });
}

/** Формулы настоящих ответов сервера (тестовые наборы) и всего выпуска контента. */
function allFormulas(): Set<string> {
  const found = new Set<string>();
  for (const file of readdirSync(DIR).filter((n) => n.startsWith("csca_") && !n.includes(".error"))) formulasOf(path.join(DIR, file), found);
  for (const file of jsonFiles(CONTENT_DIR)) formulasOf(file, found);
  return found;
}

describe("TeX: разрезка и голосовая метка (порт CSCATeXTests)", () => {
  it("режет по $", () => {
    expect(splitMathText("Find $\\log_2 8$.")).toEqual([
      { math: false, value: "Find " }, { math: true, value: "\\log_2 8" }, { math: false, value: "." },
    ]);
    expect(splitMathText("$6$")).toEqual([{ math: true, value: "6" }]);
    // Непарный $ остаётся текстом, а не съедает остаток строки.
    expect(splitMathText("cost $5").every((s) => !s.math)).toBe(true);
    expect(splitMathText("cost $5").map((s) => s.value).join("")).toBe("cost $5");
  });

  it("правила диктора", () => {
    expect(speakTex("\\frac{a}{b}")).toBe("a over b,");
    expect(speakTex("x^2")).toBe("x squared");
    expect(speakTex("\\log_2 8")).toBe("log base 2 of 8");
    expect(speakTex("\\sqrt{2}")).toBe("square root of 2,");
    expect(speakTex("x \\leq 3")).toBe("x less than or equal to 3");
    expect(speakTex("x \\in \\mathbb{R}")).toBe("x in the real numbers");
    expect(speakTex("30^\\circ")).toBe("30 degrees");
    expect(speakTex("2^{0.3}")).toBe("2 to the power 0.3,");
    expect(speakTex("12 = 2 \\cdot 6")).toBe("12 equals 2 times 6");
    expect(speakTex("2^{-x}")).toBe("2 to the power minus x,");
    expect(speakTex("y_0")).toBe("y sub 0");
    expect(speakTex("\\left(\\frac{1}{2}\\right)^{-x}")).not.toContain("\\");
    expect(speakTex("\\frac{u'v - uv'}{v^2}")).toBe("the fraction u prime v minus u v prime over v squared end fraction,");
    expect(speakMathText("Find $\\log_2 8$.")).toBe("Find log base 2 of 8.");
  });
});

describe("TeX: набор MathJax (SVG, без WebView)", () => {
  it("каждая формула реальных ответов набирается, голосовая метка без TeX", () => {
    const formulas = allFormulas();
    // Выпуск 1.1.0 даёт около 3700 разных формул; порог ниже, чтобы тест не ломался от небольших правок контента.
    expect(formulas.size).toBeGreaterThan(3000);
    const failures: string[] = [];
    for (const tex of formulas) {
      const set = typesetTex(tex, false);
      if (!set || set.widthEm <= 0 || set.heightEm <= 0) failures.push(tex);
      const spoken = speakTex(tex);
      expect(spoken).not.toContain("\\");
      expect(spoken.length).toBeGreaterThan(0);
    }
    expect(failures).toEqual([]);
  });

  it("дробь выше строки и имеет сдвиг базовой линии; штрих набирается", () => {
    const frac = typesetTex("\\frac{a}{b}", false);
    const plain = typesetTex("x", false);
    expect(frac && plain && frac.heightEm > plain.heightEm).toBe(true);
    expect(frac?.depthEm).toBeGreaterThan(0);
    expect(typesetTex("f'(x) = 3x^2", false)?.svg).toContain("<path");
    expect(typesetTex("\\frac{u'v - uv'}{v^2}", true)).not.toBeNull();
  });

  it("неразобранный TeX даёт null, а не исключение", () => {
    expect(typesetTex("\\notacommand{", false)).toBeNull();
    expect(parseMathJaxSvg("<span>no svg</span>")).toBeNull();
  });
});

/** Команды TeX, разрешённые контрактом §14 (docs/portal/csca-contract.md): шире этого набора формулы контента быть не должны. */
const CONTRACT_COMMANDS = new Set(
  ("frac sqrt log ln sin cos tan lim to infty in mathbb cdot times leq geq ne pm Rightarrow Leftrightarrow left right quad Delta parallel perp pi " +
    "alpha beta theta mu sigma omega varphi approx circ ldots cap cup subseteq emptyset notin").split(" "),
);

/** Строки выпуска, где формулы бывают: (файл, ключ, текст). */
function contentStrings(): { file: string; key: string | null; text: string }[] {
  const out: { file: string; key: string | null; text: string }[] = [];
  for (const file of jsonFiles(CONTENT_DIR)) {
    walkStrings(JSON.parse(readFileSync(file, "utf8")), null, (text, key) => out.push({ file: path.relative(CONTENT_DIR, file), key, text }));
  }
  return out;
}

describe("TeX: весь выпуск контента математики CSCA (аудит паритета, U14)", () => {
  it("выпуск прочитан целиком: файлы уроков, задания и формы", () => {
    const files = jsonFiles(CONTENT_DIR).map((file) => path.relative(CONTENT_DIR, file));
    expect(files.filter((name) => name.startsWith("lessons/")).length).toBeGreaterThanOrEqual(28);
    expect(files).toEqual(expect.arrayContaining(["items.json", "forms.json", "topics.json", "release.json"]));
    const items = JSON.parse(readFileSync(path.join(CONTENT_DIR, "items.json"), "utf8")).items as unknown[];
    expect(items.length).toBeGreaterThanOrEqual(228);
    // Строки разных видов: условия, варианты, объяснения, шаги решения, блоки уроков.
    expect(contentStrings().length).toBeGreaterThan(5000);
  });

  it("число знаков $ в каждой строке чётное: непарный $ превратил бы хвост строки в текст без формулы", () => {
    const odd = contentStrings().filter(({ key, text }) => key !== "tex" && text.split("$").length % 2 === 0);
    expect(odd.map(({ file, text }) => `${file}: ${text.slice(0, 60)}`)).toEqual([]);
  });

  it("формулы используют только команды контракта §14 и только ASCII", () => {
    const outside = new Set<string>();
    const nonAscii = new Set<string>();
    for (const tex of allFormulas()) {
      for (const match of tex.matchAll(/\\([A-Za-z]+)/gu)) if (!CONTRACT_COMMANDS.has(match[1])) outside.add(match[1]);
      for (const char of tex) if (char.charCodeAt(0) > 127) nonAscii.add(char);
    }
    expect([...outside]).toEqual([]);
    expect([...nonAscii]).toEqual([]);
  });

  it("у каждой команды формул есть слова для диктора, а не голое имя", () => {
    const silent = new Set<string>();
    for (const tex of allFormulas()) for (const match of tex.matchAll(/\\([A-Za-z]+)/gu)) if (!SPEECH_COMMANDS.has(match[1])) silent.add(match[1]);
    expect([...silent]).toEqual([]);
  });

  it("каждая формула набирается и в строке, и отдельной строкой (блок `formula`)", () => {
    const failures: string[] = [];
    for (const tex of allFormulas()) {
      for (const display of [false, true]) {
        const set = typesetTex(tex, display);
        if (!set || set.widthEm <= 0 || set.heightEm <= 0) failures.push(`${display ? "display" : "inline"}: ${tex}`);
      }
    }
    expect(failures).toEqual([]);
  });
});
