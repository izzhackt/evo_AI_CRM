// Рисунки выпуска контента на экране (аудит паритета, U15, статическая половина): все 55 рисунков проходят строгий профиль и
// пользуются только теми атрибутами текста, которые рисовальщик отдаёт react-native-svg. Сравнить вид с браузером на Android
// глазами это отдельный проход на эмуляторе; здесь проверено то, что можно проверить кодом, и стоит охрана на будущее.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { parseSvgProfile, type SvgNode } from "@/features/learning/figure/svg-profile";

const DIR = path.join(__dirname, "../../../../../docs/design/portal/content/csca/math/figures");
const files = readdirSync(DIR).filter((name) => name.endsWith(".svg")).sort();

function nodes(node: SvgNode | string): SvgNode[] {
  return typeof node === "string" ? [] : [node, ...node.children.flatMap(nodes)];
}

/** Атрибуты, которые `FigureView.propsOf` умеет перевести для текста и его частей; всё остальное пришлось бы проверять на устройстве. */
const TEXT_ATTRIBUTES = new Set(["x", "y", "dx", "dy", "fill", "font-size", "font-style", "font-weight", "text-anchor"]);

describe("рисунки выпуска контента CSCA", () => {
  it("рисунки на месте: не меньше 55 файлов", () => {
    expect(files.length).toBeGreaterThanOrEqual(55);
  });

  it("каждый рисунок проходит строгий профиль (иначе экран показал бы только подпись)", () => {
    const rejected = files.filter((name) => parseSvgProfile(readFileSync(path.join(DIR, name), "utf8")) === null);
    expect(rejected).toEqual([]);
  });

  it("кривые и многоугольники доходят до отрисовки целиком: `d` и `points` разобранного рисунка равны исходным", () => {
    let checked = 0;
    for (const name of files) {
      const source = readFileSync(path.join(DIR, name), "utf8");
      const parsed = parseSvgProfile(source);
      const expected = [...source.matchAll(/\s(d|points)="([^"]*)"/gu)].map((match) => `${match[1]}=${match[2]}`);
      const actual = (parsed ? nodes(parsed.root) : []).flatMap((node) => (["d", "points"] as const).filter((attribute) => attribute in node.attrs).map((attribute) => `${attribute}=${node.attrs[attribute]}`));
      expect([name, actual]).toEqual([name, expected]);
      checked += expected.length;
    }
    // Не пустая проверка: в выпуске десятки кривых и многоугольников, в том числе три кривые длиннее прежнего предела 4096.
    expect(checked).toBeGreaterThan(150);
  });

  it("у текста и его частей только проверенные атрибуты, `dominant-baseline` не нужен ни одному рисунку", () => {
    const unknown = new Set<string>();
    for (const name of files) {
      const parsed = parseSvgProfile(readFileSync(path.join(DIR, name), "utf8"));
      for (const node of parsed ? nodes(parsed.root) : []) {
        if (node.tag !== "text" && node.tag !== "tspan") continue;
        for (const attribute of Object.keys(node.attrs)) if (!TEXT_ATTRIBUTES.has(attribute)) unknown.add(`${name}: ${node.tag}[${attribute}]`);
      }
    }
    expect([...unknown]).toEqual([]);
  });

  it("палитра: только шесть цветов контракта, поэтому тёмная замена цветов покрывает каждую заливку", () => {
    const palette = new Set(["#ffffff", "#191714", "#6b6660", "#e4dfd7", "#d70217", "#177245"]);
    const outside = new Set<string>();
    for (const name of files) {
      for (const match of readFileSync(path.join(DIR, name), "utf8").matchAll(/#[0-9a-fA-F]{6}\b/gu)) if (!palette.has(match[0].toLowerCase())) outside.add(`${name}: ${match[0]}`);
    }
    expect([...outside]).toEqual([]);
  });
});
