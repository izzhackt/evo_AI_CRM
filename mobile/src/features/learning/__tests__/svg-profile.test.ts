import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { parseSvgProfile } from "@/features/learning/figure/svg-profile";

const DIR = path.join(__dirname, "../../../test-fixtures/csca");

function figures(): [string, string][] {
  const out: [string, string][] = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      if (typeof o.svg === "string") out.push([String(o.sha256 ?? "").slice(0, 8), o.svg]);
      Object.values(o).forEach(walk);
    }
  };
  for (const f of readdirSync(DIR).filter((n) => n.startsWith("csca_") && !n.includes(".error"))) walk(JSON.parse(readFileSync(path.join(DIR, f), "utf8")));
  return out;
}

describe("профиль SVG рисунков (контракт §15)", () => {
  it("все рисунки реальных ответов проходят профиль", () => {
    const all = figures();
    expect(all.length).toBeGreaterThan(10);
    const bad = all.filter(([, svg]) => parseSvgProfile(svg) === null).map(([sha]) => sha);
    expect(bad).toEqual([]);
  });

  const ok = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200"><rect width="400" height="200" fill="#ffffff"/><text x="10" y="20" font-size="14" fill="#191714">a&amp;b</text></svg>';
  it("принимает минимальный рисунок", () => {
    expect(parseSvgProfile(ok)?.width).toBe(400);
  });

  it.each([
    ["script", ok.replace("<rect", "<script>x</script><rect")],
    ["foreignObject", ok.replace("<rect", "<foreignObject/><rect")],
    ["image с href", ok.replace("<rect", '<image href="x"/><rect')],
    ["обработчик on*", ok.replace("<rect ", '<rect onload="x" ')],
    ["style", ok.replace("<rect ", '<rect style="fill:red" ')],
    ["цвет вне палитры", ok.replace("#ffffff", "#ff0000")],
    ["цвет-слово", ok.replace('fill="#ffffff"', 'fill="red"')],
    ["url()", ok.replace('fill="#ffffff"', 'fill="url(#a)"')],
    ["DTD", `<!DOCTYPE svg>${ok}`],
    ["инструкция", `<?xml version="1.0"?>${ok}`],
    ["комментарий", ok.replace("<rect", "<!-- c --><rect")],
    ["чужая сущность", ok.replace("a&amp;b", "a&nbsp;b")],
    ["два корня", ok + ok],
    ["viewBox вне диапазона", ok.replace("0 0 400 200", "0 0 900 200")],
    ["viewBox не с нуля", ok.replace("0 0 400 200", "5 0 400 200")],
    ["более 24 КБ", ok.replace("a&amp;b", "x".repeat(25_000))],
    ["неизвестный атрибут", ok.replace("<rect ", '<rect id="a" ')],
    ["вложенный svg", ok.replace("<rect", "<svg/><rect")],
    ["tspan вне text", ok.replace("<rect", "<tspan/><rect")],
    ["не закрыт", ok.replace("</svg>", "")],
    ["слишком длинное значение обычного атрибута", ok.replace('font-size="14"', `font-size="${"1".repeat(65)}"`)],
    ["слишком длинный font-family", ok.replace('<svg ', `<svg font-family="${"a".repeat(97)}" `)],
    ["слишком длинный transform", ok.replace("<rect ", `<rect transform="${"translate(1 1)".repeat(12)}" `)],
  ])("отклоняет: %s", (_name, svg) => {
    expect(parseSvgProfile(svg)).toBeNull();
  });
});
