// Строгий профиль SVG рисунков CSCA (контракт §15, порт CSCASVG.swift iPhone 1.1).
// Рисунок приходит строкой в ответе сервера и НИКОГДА не отдаётся рендереру как есть:
// строка разбирается своим разборщиком по белому списку и только потом превращается в
// элементы react-native-svg. Всё вне профиля (элемент, атрибут, цвет, сущность, DTD,
// инструкция, комментарий, размер) отклоняет рисунок целиком; экран показывает alt.

export type SvgNode = Readonly<{ tag: SvgTag; attrs: Readonly<Record<string, string>>; children: readonly (SvgNode | string)[] }>;

export const SVG_TAGS = ["svg", "title", "rect", "line", "circle", "path", "polygon", "text", "tspan"] as const;
export type SvgTag = (typeof SVG_TAGS)[number];

export const SVG_ATTRS: ReadonlySet<string> = new Set([
  "xmlns", "viewBox", "width", "height", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "d", "points", "dx", "dy",
  "transform", "fill", "stroke", "stroke-width", "stroke-dasharray", "stroke-linecap", "stroke-linejoin", "opacity", "fill-opacity",
  "stroke-opacity", "font-family", "font-size", "font-style", "font-weight", "text-anchor", "dominant-baseline",
]);

/** Палитра рисунка (светлая, как в данных). */
export const SVG_PALETTE: ReadonlySet<string> = new Set(["#ffffff", "#191714", "#6b6660", "#e4dfd7", "#d70217", "#177245"]);

const MAX_BYTES = 24 * 1024;
const NUMBER = /^-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?$/iu;
const NUMBER_LIST = /^[-0-9.eE\s,]+$/u;
const PATH_DATA = /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,\s-]+$/u;
const TRANSFORM = /^(?:\s*(?:translate|rotate|scale|matrix)\(\s*[-0-9.eE\s,]+\))+\s*$/u;
const DASH = /^[0-9.\s,]+$/u;
const ENUM: Readonly<Record<string, ReadonlySet<string>>> = {
  "stroke-linecap": new Set(["butt", "round", "square"]),
  "stroke-linejoin": new Set(["miter", "round", "bevel"]),
  "font-style": new Set(["normal", "italic"]),
  "font-weight": new Set(["normal", "bold", "400", "500", "600", "700"]),
  "text-anchor": new Set(["start", "middle", "end"]),
  "dominant-baseline": new Set(["auto", "middle", "central", "hanging", "alphabetic"]),
};
const ELEMENT_RE = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[a-zA-Z][a-zA-Z0-9-]*="[^"<>]{0,4096}")*)\s*(\/?)>/y;
const ATTR_RE = /\s+([a-zA-Z][a-zA-Z0-9-]*)="([^"<>]{0,4096})"/gy;
const ENTITY_RE = /&(#[0-9]{1,6}|#x[0-9a-fA-F]{1,5}|amp|lt|gt|quot|apos);/gu;

function decodeEntities(text: string): string | null {
  if (/&(?!(?:#[0-9]{1,6}|#x[0-9a-fA-F]{1,5}|amp|lt|gt|quot|apos);)/u.test(text)) return null;
  return text.replace(ENTITY_RE, (_, name: string) => {
    if (name === "amp") return "&";
    if (name === "lt") return "<";
    if (name === "gt") return ">";
    if (name === "quot") return '"';
    if (name === "apos") return "'";
    const code = name.startsWith("#x") ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
    return Number.isInteger(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : "";
  });
}

/** Длина значения проверяется до любого регулярного выражения: обычные атрибуты короткие, длинные только у геометрии. */
const MAX_VALUE: Readonly<Record<string, number>> = { d: 4096, points: 2048, transform: 128, "font-family": 96, "stroke-dasharray": 64 };
const DEFAULT_MAX_VALUE = 64;

function validValue(name: string, value: string): boolean {
  if (value.length > (MAX_VALUE[name] ?? DEFAULT_MAX_VALUE)) return false;
  switch (name) {
    case "xmlns": return value === "http://www.w3.org/2000/svg";
    case "viewBox": return /^0 0 \d{3} \d{3}$/u.test(value);
    case "width": case "height": case "x": case "y": case "x1": case "y1": case "x2": case "y2": case "cx": case "cy": case "r": case "rx": case "ry": case "dx": case "dy":
    case "stroke-width": case "font-size": case "opacity": case "fill-opacity": case "stroke-opacity":
      return NUMBER.test(value);
    case "points": return NUMBER_LIST.test(value);
    case "d": return PATH_DATA.test(value);
    case "transform": return TRANSFORM.test(value);
    case "stroke-dasharray": return DASH.test(value);
    case "fill": case "stroke": return value === "none" || (/^#[0-9a-f]{6}$/iu.test(value) && SVG_PALETTE.has(value.toLowerCase()));
    case "font-family": return /^[A-Za-z0-9 ,'-]+$/u.test(value) && !/url|data:/iu.test(value);
    default: return ENUM[name]?.has(value) ?? false;
  }
}

function parseAttrs(source: string): Record<string, string> | null {
  const attrs: Record<string, string> = {};
  ATTR_RE.lastIndex = 0;
  let consumed = 0;
  for (let m = ATTR_RE.exec(source); m; m = ATTR_RE.exec(source)) {
    const [whole, name, raw] = m;
    consumed += whole.length;
    const value = decodeEntities(raw);
    if (value === null || !SVG_ATTRS.has(name) || Object.hasOwn(attrs, name) || !validValue(name, value)) return null;
    attrs[name] = value;
  }
  return consumed === source.length ? attrs : null;
}

/** Разобрать рисунок по профилю; `null`, если хоть что-то вне профиля. */
export function parseSvgProfile(svg: string): { root: SvgNode; width: number; height: number } | null {
  if (svg.length === 0 || svg.length > MAX_BYTES || svg.includes("<!") || svg.includes("<?") || /(?<![-\w])on[a-z]+\s*=|href|url\(|data:|(?<![-\w])style\s*=|javascript:/iu.test(svg)) return null;
  const stack: { tag: SvgTag; attrs: Record<string, string>; children: (SvgNode | string)[] }[] = [];
  let root: SvgNode | null = null;
  let index = 0;
  while (index < svg.length) {
    if (svg[index] !== "<") {
      const end = svg.indexOf("<", index);
      const raw = svg.slice(index, end === -1 ? svg.length : end);
      index = end === -1 ? svg.length : end;
      const top = stack[stack.length - 1];
      if (raw.trim().length === 0) continue; // пробелы между элементами
      const text = decodeEntities(raw);
      if (text === null || !top || (top.tag !== "text" && top.tag !== "tspan" && top.tag !== "title")) return null;
      top.children.push(text);
      continue;
    }
    ELEMENT_RE.lastIndex = index;
    const m = ELEMENT_RE.exec(svg);
    if (!m) return null;
    index += m[0].length;
    const [, closing, name, attrSource, selfClose] = m;
    if (!(SVG_TAGS as readonly string[]).includes(name)) return null;
    const tag = name as SvgTag;
    if (closing) {
      const open = stack.pop();
      if (!open || open.tag !== tag || attrSource.trim().length > 0 || selfClose) return null;
      const node: SvgNode = { tag, attrs: open.attrs, children: open.children };
      const parent = stack[stack.length - 1];
      if (parent) parent.children.push(node);
      else if (root) return null;
      else root = node;
      continue;
    }
    const attrs = parseAttrs(attrSource);
    if (!attrs) return null;
    const parent = stack[stack.length - 1];
    if (!parent && (tag !== "svg" || root)) return null; // один корень <svg>
    if (parent && tag === "svg") return null;
    if (tag === "tspan" && parent?.tag !== "text" && parent?.tag !== "tspan") return null;
    if (tag === "title" && parent?.tag !== "svg") return null;
    if (parent && (parent.tag === "text" || parent.tag === "tspan" || parent.tag === "title") && tag !== "tspan") return null;
    if (selfClose) {
      const node: SvgNode = { tag, attrs, children: [] };
      if (parent) parent.children.push(node);
      else return null;
    } else {
      stack.push({ tag, attrs, children: [] });
    }
  }
  if (stack.length > 0 || !root) return null;
  const view = root.attrs.viewBox?.split(" ").map(Number);
  if (!view || view[0] !== 0 || view[1] !== 0) return null;
  const [, , width, height] = view;
  if (width < 360 || width > 450 || height < 100 || height > 600) return null;
  return { root, width, height };
}
