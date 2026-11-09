import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { formulasIn, speakMathText, speakTex } from "@/features/learning/math/speak";
import { parseMathJaxSvg, typesetTex } from "@/features/learning/math/mathjax-svg";
import { splitMathText } from "@web/lib/portal/csca";

const DIR = path.join(__dirname, "../../../test-fixtures/csca");

function allFormulas(): Set<string> {
  const found = new Set<string>();
  const walk = (value: unknown, key: string | null) => {
    if (Array.isArray(value)) value.forEach((v) => walk(v, key));
    else if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) if (k !== "svg") walk(v, k);
    } else if (typeof value === "string") {
      if (key === "tex") found.add(value);
      else formulasIn(value).forEach((f) => found.add(f));
    }
  };
  for (const file of readdirSync(DIR).filter((n) => n.startsWith("csca_") && !n.includes(".error"))) {
    walk(JSON.parse(readFileSync(path.join(DIR, file), "utf8")), null);
  }
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
    expect(formulas.size).toBeGreaterThan(300);
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
