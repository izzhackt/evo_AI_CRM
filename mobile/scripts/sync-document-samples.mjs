#!/usr/bin/env node
// Справка «Пример»: два файла из <repo>/public/portal/document-samples.
//  1) document-samples.generated.ts: нарисованные схемы (*.svg, имя файла -> текст SVG). Ссылка на каждую - `sampleSrc`
//     в src/lib/portal/document-guides.ts. Схемы зашиты в приложение: это запасной вид «Примера», когда у документа
//     нет настоящих образцов или нет сети.
//  2) document-sample-sizes.generated.ts: размеры настоящих страниц (*.jpg без миниатюр `-t.jpg`, имя -> [ширина, высота]
//     из заголовка JPEG). Само изображение в сборку НЕ кладётся: размер нужен, чтобы страница сразу встала в рамку по
//     пропорциям (тень и скругление листа, масштаб в крупном просмотре), не дожидаясь загрузки.
// Настоящие образцы (JPG, миниатюры `-t.jpg` и бланк PDF, около 6 МБ) лист «Пример» грузит по адресу портала,
// `<адрес портала>/portal/document-samples/<файл>`, без входа (кэш ведёт expo-image).
// Второй копии рисунков нет: одна правда - файлы веба.
//   node scripts/sync-document-samples.mjs           записать файлы
//   node scripts/sync-document-samples.mjs --check   упасть, если файл устарел (npm run check)
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const mobileRoot = path.resolve(here, "..");
const sourceDir = path.resolve(mobileRoot, "../public/portal/document-samples");
const schemesPath = path.join(mobileRoot, "src/features/documents/document-samples.generated.ts");
const sizesPath = path.join(mobileRoot, "src/features/documents/document-sample-sizes.generated.ts");

/** Ширина и высота JPEG по заголовку кадра (SOFn). Не JPEG или нет кадра - ошибка, молча не подставляем. */
export function jpegSize(bytes, name = "jpeg") {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error(`${name}: не JPEG`);
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) throw new Error(`${name}: сломан заголовок JPEG`);
    const marker = bytes[offset + 1];
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const length = bytes.readUInt16BE(offset + 2);
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      const height = bytes.readUInt16BE(offset + 5);
      const width = bytes.readUInt16BE(offset + 7);
      if (width < 1 || height < 1) throw new Error(`${name}: нулевой размер`);
      return [width, height];
    }
    offset += 2 + length;
  }
  throw new Error(`${name}: в JPEG нет кадра`);
}

function build() {
  const all = readdirSync(sourceDir).sort();
  const svgs = all.filter((name) => name.endsWith(".svg"));
  const pages = all.filter((name) => name.endsWith(".jpg") && !name.endsWith("-t.jpg"));
  const schemes = svgs.map((name) => `  ${JSON.stringify(name)}: ${JSON.stringify(readFileSync(path.join(sourceDir, name), "utf8").trim())},`).join("\n");
  const sizes = pages.map((name) => `  ${JSON.stringify(name)}: [${jpegSize(readFileSync(path.join(sourceDir, name)), name).join(", ")}],`).join("\n");
  return {
    svgs,
    pages,
    schemesText: `// Сгенерировано scripts/sync-document-samples.mjs из public/portal/document-samples. Не править вручную.\nexport const DOCUMENT_SAMPLE_SVG: Readonly<Record<string, string>> = {\n${schemes}\n};\n`,
    sizesText: `// Сгенерировано scripts/sync-document-samples.mjs из public/portal/document-samples. Не править вручную.\n// Размеры страниц настоящих образцов (ширина, высота в пикселях): сами картинки в сборке не лежат.\nexport const DOCUMENT_SAMPLE_SIZES: Readonly<Record<string, readonly [number, number]>> = {\n${sizes}\n};\n`,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { svgs, pages, schemesText, sizesText } = build();
  const targets = [
    [schemesPath, schemesText, "document-samples.generated.ts"],
    [sizesPath, sizesText, "document-sample-sizes.generated.ts"],
  ];
  if (process.argv.includes("--check")) {
    for (const [file, text, label] of targets) {
      if (!existsSync(file) || readFileSync(file, "utf8") !== text) {
        console.error(`${label} устарел: npm run sync-document-samples`);
        process.exit(1);
      }
      console.log(`${label} актуален`);
    }
  } else {
    for (const [file, text] of targets) writeFileSync(file, text);
    console.log(`document-samples.generated.ts: ${svgs.length} схем; document-sample-sizes.generated.ts: ${pages.length} страниц`);
  }
}
