#!/usr/bin/env node
// Нарисованные схемы документов для справки «Пример»: <repo>/public/portal/document-samples/*.svg
// (вымышленные схемы веба, ссылка на каждую - `sampleSrc` в src/lib/portal/document-guides.ts)
// -> src/features/documents/document-samples.generated.ts (имя файла -> текст SVG).
// Схемы зашиты в приложение: это запасной вид «Примера», когда у документа нет настоящих образцов или нет сети.
// Настоящие образцы (JPG, миниатюры `-t.jpg` и бланк PDF, около 6 МБ) в сборку НЕ кладутся: лист «Пример» грузит их
// по адресу портала, `<адрес портала>/portal/document-samples/<файл>`, без входа (кэш ведёт expo-image).
// Второй копии рисунков нет: одна правда - файлы веба.
//   node scripts/sync-document-samples.mjs           записать файл
//   node scripts/sync-document-samples.mjs --check   упасть, если файл устарел (npm run check)
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const mobileRoot = path.resolve(here, "..");
const sourceDir = path.resolve(mobileRoot, "../public/portal/document-samples");
const outPath = path.join(mobileRoot, "src/features/documents/document-samples.generated.ts");

const names = readdirSync(sourceDir).filter((name) => name.endsWith(".svg")).sort();
const body = names.map((name) => `  ${JSON.stringify(name)}: ${JSON.stringify(readFileSync(path.join(sourceDir, name), "utf8").trim())},`).join("\n");
const text = `// Сгенерировано scripts/sync-document-samples.mjs из public/portal/document-samples. Не править вручную.\nexport const DOCUMENT_SAMPLE_SVG: Readonly<Record<string, string>> = {\n${body}\n};\n`;

if (process.argv.includes("--check")) {
  if (!existsSync(outPath) || readFileSync(outPath, "utf8") !== text) {
    console.error("document-samples.generated.ts устарел: npm run sync-document-samples");
    process.exit(1);
  }
  console.log("document-samples.generated.ts актуален");
} else {
  writeFileSync(outPath, text);
  console.log(`document-samples.generated.ts: ${names.length} образцов`);
}
