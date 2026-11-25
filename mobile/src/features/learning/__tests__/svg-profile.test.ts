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

  // Кривая графика это сотни точек в одном атрибуте `d`, а у многоугольника столько же в `points`; у трёх настоящих рисунков
  // выпуска `d` занимает 4690-5446 знаков. Раньше пределы стояли на 4096 и 2048, и такие рисунки на экране не рисовались
  // (виден был только alt). Сервер ограничивает только весь рисунок (24 КБ), и приложение теперь так же.
  const withPath = (length: number) => ok.replace("<rect", `<path d="M10 10 ${"L10 20 ".repeat(Math.ceil(length / 7))}" stroke="#191714" fill="none"/><rect`);
  const withPolygon = (length: number) => ok.replace("<rect", `<polygon points="${"10,20 ".repeat(Math.ceil(length / 6))}" fill="#e4dfd7"/><rect`);
  const attributeOf = (svg: string, tag: string, name: string) => {
    const node = parseSvgProfile(svg)?.root.children.find((child) => typeof child !== "string" && child.tag === tag);
    return typeof node === "object" ? node.attrs[name] : undefined;
  };

  it("принимает длинные данные кривой графика (5000 знаков и больше прежнего предела 4096)", () => {
    const svg = withPath(5_000);
    expect(svg.length).toBeGreaterThan(5_000);
    expect(attributeOf(svg, "path", "d")?.length).toBeGreaterThan(4_096);
  });

  it("принимает длинные точки многоугольника (больше прежнего предела 2048)", () => {
    const svg = withPolygon(5_000);
    expect(attributeOf(svg, "polygon", "points")?.length).toBeGreaterThan(2_048);
  });

  it("длинная геометрия не обходит размер рисунка: больше 24 КБ отклоняется целиком (кривая и многоугольник)", () => {
    expect(parseSvgProfile(withPath(24_600))).toBeNull();
    expect(parseSvgProfile(withPolygon(24_600))).toBeNull();
  });

  it("длинное значение негеометрического атрибута по-прежнему отклоняется (длинным бывает только `d` и `points`)", () => {
    expect(parseSvgProfile(ok.replace('font-size="14"', `font-size="${"1".repeat(65)}"`))).toBeNull();
    expect(parseSvgProfile(ok.replace("<rect ", `<rect transform="${"translate(1 1)".repeat(12)}" `))).toBeNull();
  });

  it("длинные значения не мешают разбору соседних атрибутов и элементов: после кривой на 5 КБ рисунок разобран целиком", () => {
    const parsed = parseSvgProfile(withPolygon(5_000).replace("<rect", `<path d="M10 10 ${"L10 20 ".repeat(800)}" stroke="#191714" fill="none"/><rect`));
    expect(parsed?.root.children.filter((child) => typeof child !== "string").map((child) => (child as { tag: string }).tag)).toEqual(["polygon", "path", "rect", "text"]);
  });
});
