"use strict";

/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Сценарий стенда `admin-next-static-render.cjs` по независимой проверке сборки 2B (28.10.2026): итоговые таблицы отчётов («Маркетинг → Обзор», «ИИ-агент →
 * Расходы») берут фокус с клавиатуры, и полоса фокуса должна быть видна по всему периметру области. Карточка таблицы режет всё, что вынесено за её край
 * (`overflow-hidden`), общее правило рисует полосу снаружи на 2–3 px, а полосу внутри области закрывает прилипший первый столбец (`z-10`). Поэтому
 * проверяется не стиль, а картинка: снимок области с фокусом и без него (Tab, затем `blur`), на каждой из четырёх сторон у края области (до 8 px
 * снаружи и 3 px внутри) цвет должен отличаться почти по всей длине. До исправления не отличался нигде (0 точек); с полосой внутри, но под прилипшим
 * столбцом, закрытой оказывалась треть верхней и нижней сторон и вся левая сторона.
 */
const { writeFileSync } = require("node:fs");
const { join } = require("node:path");

const REGIONS = {
  "marketing-overview": ["Таблица заявок по каналам", "Таблица договоров по каналам"],
  "ai-spend": ["Расходы по назначению"],
};
const MIN_COVERAGE = 0.9;
const CORNER = 12;
/** Где искать полосу у каждой стороны области: от 8 px снаружи до 3 px внутри (полоса у края, снаружи на отступе или внутри — как нарисована). */
const OUTSIDE = 8;
const INSIDE = 3;

/** Доля длины каждой стороны области (без углов), где у края (от 8 px снаружи до 3 px внутри) цвет отличается заметно (≥ 32 из 255); считает сама страница стенда. */
const sideCoverage = (page, before, after, area) => page.evaluate(async ([a, b, [ox, oy, width, height], outside, inside]) => {
  const decode = async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d");
    context.drawImage(bitmap, 0, 0);
    return { data: context.getImageData(0, 0, bitmap.width, bitmap.height).data, width: bitmap.width };
  };
  const [first, second] = [await decode(a), await decode(b)];
  const differs = (x, y) => {
    const at = (y * first.width + x) * 4;
    return Math.max(Math.abs(first.data[at] - second.data[at]), Math.abs(first.data[at + 1] - second.data[at + 1]), Math.abs(first.data[at + 2] - second.data[at + 2])) >= 32;
  };
  const along = (length, probe) => {
    let hit = 0;
    for (let step = 12; step < length - 12; step += 1) {
      for (let depth = -outside; depth < inside; depth += 1) if (probe(step, depth)) { hit += 1; break; }
    }
    return Math.round((hit / (length - 24)) * 100) / 100;
  };
  return {
    top: along(width, (step, depth) => differs(ox + step, oy + depth)),
    bottom: along(width, (step, depth) => differs(ox + step, oy + height - 1 - depth)),
    left: along(height, (step, depth) => differs(ox + depth, oy + step)),
    right: along(height, (step, depth) => differs(ox + width - 1 - depth, oy + step)),
  };
}, [before.toString("base64"), after.toString("base64"), area, OUTSIDE, INSIDE]);

module.exports = function register({ flow: addFlow }) {
  const flow = (name, run) => addFlow(name, async (env) => {
    try { await run(env); } catch (error) { env.report(`${name}: the scenario ran to the end`, false, String(error?.message ?? error).split("\n")[0]); }
  });
  for (const [name, labels] of Object.entries(REGIONS)) {
    for (const key of ["d1440", "d1280"]) {
      flow(`report-table-focus ${name} ${key}`, async (env) => {
        const { context, page } = await env.open(name, key);
        for (const label of labels) {
          const region = page.getByRole("region", { name: label, exact: true });
          let reached = false;
          for (let press = 0; press < 200 && !reached; press += 1) {
            await page.keyboard.press("Tab");
            reached = await page.evaluate((text) => document.activeElement?.getAttribute("aria-label") === text, label);
          }
          env.report(`${name} ${key} «${label}»: Tab reaches the table region and it matches :focus-visible`, reached && (await region.evaluate((element) => element.matches(":focus-visible"))), reached);
          // Вся область с полем вокруг должна быть на экране: Tab прокручивает ровно настолько, чтобы показать начало, нижняя сторона может остаться за краем окна.
          await region.evaluate((element) => element.scrollIntoView({ block: "center", inline: "nearest" }));
          const box = await region.boundingBox();
          const viewport = page.viewportSize();
          env.report(`${name} ${key} «${label}»: the whole region with its margin fits in the window for the picture`, box.y >= CORNER && box.y + box.height + CORNER <= viewport.height, { y: Math.round(box.y), height: Math.round(box.height), window: viewport.height });
          const clip = { x: Math.max(0, box.x - CORNER), y: Math.max(0, box.y - CORNER) };
          clip.width = Math.min(viewport.width - clip.x, box.width + 2 * CORNER);
          clip.height = Math.min(viewport.height - clip.y, box.height + 2 * CORNER);
          const focused = await page.screenshot({ clip });
          writeFileSync(join(env.outDir, `focus-${name}-${key}-${labels.indexOf(label)}.png`), focused);
          await region.evaluate((element) => element.blur());
          const blurred = await page.screenshot({ clip });
          const sides = await sideCoverage(page, focused, blurred, [box.x - clip.x, box.y - clip.y, Math.round(box.width), Math.round(box.height)]);
          env.report(`${name} ${key} «${label}»: the focus ring is visible on all four sides (≥ ${MIN_COVERAGE * 100}% of each side differs from the blurred picture)`, Object.values(sides).every((share) => share >= MIN_COVERAGE), sides);
        }
        await context.close();
      });
    }
  }
};
