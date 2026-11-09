// TeX в SVG без WebView и без DOM: MathJax 3 (Apache-2.0) с входом TeX (только пакет base),
// выходом SVG с кривыми вместо шрифта (fontCache: none) и «лёгким» адаптером. Результат
// рисует react-native-svg. Подмножество команд задаёт контракт §14
// (docs/portal/csca-contract.md); формулы — латиница, цифры, знаки, без кириллицы.
// Проверка: каждая формула настоящих ответов набирается (__tests__/math.test.ts), вид на симуляторе iOS проверен.
import { mathjax } from "mathjax-full/js/mathjax.js";
import { TeX } from "mathjax-full/js/input/tex.js";
import { SVG } from "mathjax-full/js/output/svg.js";
import { liteAdaptor } from "mathjax-full/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "mathjax-full/js/handlers/html.js";
import "mathjax-full/js/input/tex/base/BaseConfiguration.js";

export type TexMetrics = Readonly<{
  /** SVG без цвета: fill/stroke = `currentColor`. */
  svg: string;
  /** Ширина и высота в em (1 em = размер шрифта текста). */
  widthEm: number;
  heightEm: number;
  /** Сдвиг базовой линии вниз от нижнего края, em (>= 0 у формул с нижними выносными). */
  depthEm: number;
}>;

/** MathJax: 1 em = 1000 единиц viewBox; 1 ex = 0.442 em (xHeight шрифта TeX). */
const EX = 0.442;
const UNITS_PER_EM = 1000;

type Engine = { render: (tex: string, display: boolean) => string };
let engine: Engine | null = null;

function createEngine(): Engine {
  const adaptor = liteAdaptor();
  RegisterHTMLHandler(adaptor);
  const doc = mathjax.document("", {
    InputJax: new TeX({ packages: ["base"] }),
    OutputJax: new SVG({ fontCache: "none" }),
  });
  return {
    render(tex, display) {
      const node = doc.convert(tex, { display });
      return adaptor.outerHTML(node);
    },
  };
}

const cache = new Map<string, TexMetrics | null>();
const CACHE_LIMIT = 600;

/** Разбор `<svg …>` MathJax: размеры, сдвиг и тело без атрибута `style`. */
export function parseMathJaxSvg(html: string): TexMetrics | null {
  if (html.includes('data-mml-node="merror"') || html.includes("<mjx-assistive")) return null;
  const open = /<svg\b([^>]*)>/u.exec(html);
  const close = html.lastIndexOf("</svg>");
  if (!open || close < 0) return null;
  const attrs = open[1];
  const viewBox = /viewBox="([-0-9.e ]+)"/u.exec(attrs)?.[1]?.split(/\s+/u).map(Number);
  const align = /vertical-align:\s*(-?[0-9.]+)ex/u.exec(attrs)?.[1];
  if (!viewBox || viewBox.length !== 4 || viewBox.some((n) => !Number.isFinite(n))) return null;
  const [minX, minY, width, height] = viewBox;
  const body = html.slice(open.index + open[0].length, close);
  const depthEm = align === undefined ? 0 : -Number(align) * EX;
  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${width} ${height}">${body}</svg>`,
    widthEm: width / UNITS_PER_EM,
    heightEm: height / UNITS_PER_EM,
    depthEm,
  };
}

/** Набрать формулу; `null`, если TeX не разобран (экран покажет исходный текст). */
export function typesetTex(tex: string, display = false): TexMetrics | null {
  const cacheKey = `${display ? "d" : "i"}|${tex}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey) ?? null;
  let result: TexMetrics | null = null;
  try {
    engine ??= createEngine();
    result = parseMathJaxSvg(engine.render(tex, display));
  } catch {
    result = null;
  }
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  cache.set(cacheKey, result);
  return result;
}

/** Цвет в SVG: `currentColor` заменяется значением темы. */
export function colorizeSvg(svg: string, color: string): string {
  return svg.replaceAll("currentColor", color);
}
