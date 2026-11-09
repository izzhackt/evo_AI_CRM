#!/usr/bin/env node
// Брендовые ассеты приложения: знак EVO (векторный путь из logobook, стр. 9) -> PNG.
// Источники: путь знака в src/ui/EvoMark.tsx, цвета в src/theme/tokens.generated.ts.
// Запуск: node scripts/generate-brand-assets.mjs   (нужен sharp: он есть в корневых зависимостях репозитория,
// установите `npm ci` в корне или экспортируйте NODE_PATH=<репозиторий>/node_modules).
// Результат детерминирован и лежит в Git; перезапускать нужно только при смене знака или токенов.
import { readFileSync, mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const mobileRoot = path.resolve(here, "..");
const out = path.join(mobileRoot, "assets/images");

function loadSharp() {
  for (const base of [mobileRoot, path.resolve(mobileRoot, "..")]) {
    try {
      return createRequire(path.join(base, "noop.js"))("sharp");
    } catch {
      /* пробуем дальше */
    }
  }
  if (process.env.NODE_PATH) { const require = createRequire(import.meta.url);
    return createRequire(path.join(mobileRoot, "noop.js"))(
      require.resolve("sharp", { paths: process.env.NODE_PATH.split(path.delimiter) }),
    );
  }
  throw new Error("Не найден sharp: выполните npm ci в корне репозитория или задайте NODE_PATH.");
}
const sharp = loadSharp();

const markSource = readFileSync(path.join(mobileRoot, "src/ui/EvoMark.tsx"), "utf8");
const MARK_PATH = /const MARK_PATH =\s*"([^"]+)"/.exec(markSource)?.[1];
if (!MARK_PATH) throw new Error("MARK_PATH не найден в src/ui/EvoMark.tsx");

const tokens = readFileSync(path.join(mobileRoot, "src/theme/tokens.generated.ts"), "utf8");
function token(set, name) {
  const start = tokens.indexOf(`export const ${set} = {`);
  const m = new RegExp(`"${name}": "(#[0-9a-fA-F]{6})"`).exec(tokens.slice(start));
  if (!m) throw new Error(`Токен ${set}.${name} не найден`);
  return m[1];
}
const RED = token("lightTokens", "brandRed"); // #d70217
const WHITE = "#ffffff";

// Знак занимает viewBox 100x100 (фактически 6.29..93.71 по x, 0..100 по y).
// Рисуем его в квадрате size; box = доля стороны, занятая высотой знака.
function markSvg(size, box, fill, background) {
  const scale = (size * box) / 100;
  const offset = (size - 100 * scale) / 2;
  const bg = background ? `<rect width="${size}" height="${size}" fill="${background}"/>` : "";
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${bg}` +
      `<path transform="translate(${offset} ${offset}) scale(${scale})" d="${MARK_PATH}" fill="${fill}" fill-rule="evenodd"/></svg>`,
  );
}

async function png(file, svg, { flatten } = {}) {
  let img = sharp(svg, { density: 72 }).png({ compressionLevel: 9 });
  if (flatten) img = sharp(svg, { density: 72 }).flatten({ background: flatten }).removeAlpha().png({ compressionLevel: 9 });
  await img.toFile(path.join(out, file));
  console.log("assets/images/" + file);
}

mkdirSync(out, { recursive: true });
// Шаблонные файлы Expo, которые больше не используются.
rmSync(path.join(mobileRoot, "assets/expo.icon"), { recursive: true, force: true });

// iOS: 1024x1024 без альфа-канала. Красная плитка, белый знак (инверсная трактовка logobook).
await png("icon.png", markSvg(1024, 0.56, WHITE, RED), { flatten: RED });
// iOS тёмный и tinted варианты (необязательные): тёмный фон, красный знак; tinted: светлый знак на чёрном.
await png("icon-dark.png", markSvg(1024, 0.56, RED, token("darkTokens", "bg")), { flatten: token("darkTokens", "bg") });
await png("icon-tinted.png", markSvg(1024, 0.56, WHITE, "#000000"), { flatten: "#000000" });
// Android adaptive: слои 1024 (108dp), безопасная зона = центральные 66%: знак ниже 0.5 стороны.
await png("android-icon-foreground.png", markSvg(1024, 0.5, WHITE));
await png("android-icon-background.png", Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="${RED}"/></svg>`), { flatten: RED });
await png("android-icon-monochrome.png", markSvg(1024, 0.5, "#000000"));
// Заставка: знак без фона (фон задаёт плагин expo-splash-screen); светлая тема: красный знак, тёмная: акцент тёмной темы.
await png("splash-icon.png", markSvg(512, 1, RED));
await png("splash-icon-dark.png", markSvg(512, 1, token("darkTokens", "accent")));
// Фавикон веб-версии.
await png("favicon.png", markSvg(96, 0.9, RED));
