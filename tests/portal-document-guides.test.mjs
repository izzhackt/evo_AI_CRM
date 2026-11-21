import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

import {
  documentGuideSamples,
  documentGuideView,
  DOCUMENT_GUIDE_TYPES,
} from "../src/lib/portal/document-guides.ts";
import { PORTAL_DICTIONARIES } from "../src/lib/portal/i18n.ts";
import { DOCUMENT_SAMPLE_SETS } from "../src/lib/portal/document-sample-sets.ts";
import { isDocumentSampleFile } from "../src/lib/platform-route-contract.ts";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../", import.meta.url));
const { AppRouterContext } = require("next/dist/shared/lib/app-router-context.shared-runtime.js");

const cache = new Map();

function resolveSource(base) {
  const candidates = [base, `${base}.tsx`, `${base}.ts`, `${base}.js`];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function loadModule(file) {
  const existing = cache.get(file);
  if (existing) return existing.exports;
  const source = readFileSync(file, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
    fileName: file,
  }).outputText;
  const mod = { exports: {} };
  cache.set(file, mod);
  const localRequire = (specifier) => {
    if (specifier.startsWith("@/")) {
      const resolved = resolveSource(path.join(root, "src", specifier.slice(2)));
      if (!resolved) throw new Error(`Cannot resolve ${specifier}`);
      return loadModule(resolved);
    }
    if (specifier.startsWith(".")) {
      const resolved = resolveSource(path.resolve(path.dirname(file), specifier));
      if (!resolved) throw new Error(`Cannot resolve ${specifier} from ${file}`);
      return loadModule(resolved);
    }
    return require(specifier);
  };
  new Function("require", "module", "exports", compiled)(localRequire, mod, mod.exports);
  return mod.exports;
}

const { DocumentGuideSlot } = loadModule(path.join(root, "src/components/portal/admission/DocumentGuide.tsx"));

const router = {
  back() {},
  forward() {},
  refresh() {},
  hmrRefresh() {},
  push() {},
  replace() {},
  prefetch() {},
};

function renderGuide(props) {
  return renderToStaticMarkup(createElement(
    AppRouterContext.Provider,
    { value: router },
    createElement(DocumentGuideSlot, props),
  ));
}

const SLOT = "10000000-0000-4000-8000-000000000001";

test("every guide has the same RU and KY shape, a fake sample, and at most three lines", () => {
  assert.equal(DOCUMENT_GUIDE_TYPES.length, documentGuideSamples().length);
  const ruKeys = Object.keys(PORTAL_DICTIONARIES.admission.ru).filter((key) => key.startsWith("guide"));
  const kyKeys = Object.keys(PORTAL_DICTIONARIES.admission.ky).filter((key) => key.startsWith("guide"));
  assert.deepEqual(ruKeys, kyKeys);
  for (const key of ruKeys) {
    assert.notEqual(PORTAL_DICTIONARIES.admission.ky[key], PORTAL_DICTIONARIES.admission.ru[key], key);
  }
  for (const sample of documentGuideSamples()) {
    const ru = documentGuideView({ requirementKey: sample.typeKey, label: "" }, "ru");
    const ky = documentGuideView({ requirementKey: sample.typeKey, label: "" }, "ky");
    assert.ok(ru);
    assert.ok(ky);
    assert.equal(ru.typeKey, sample.typeKey);
    assert.equal(ky.where.length, ru.where.length);
    assert.ok(ru.where.length >= 1 && ru.where.length <= 3);
    assert.ok(ru.pins.length >= 1 && ru.pins.length <= 3);
    assert.deepEqual(ru.pins.map((pin) => pin.n), ky.pins.map((pin) => pin.n));
    assert.notEqual(ky.description, ru.description);
    assert.equal(ru.sampleSrc, sample.sampleSrc);
    const file = path.join(root, "public", sample.sampleSrc);
    const svg = readFileSync(file, "utf8");
    assert.match(svg, /ОБРАЗЕЦ/u);
    assert.match(svg, /Sample only|Invented|invented|Diagram only/u);
    assert.doesNotMatch(svg, /@gmail\.com|@mail\.ru/u);
  }
});

test("known checklist labels and requirement keys open a guide, unknown labels do not", () => {
  const labels = [
    ["Загранпаспорт", "passport"],
    ["Паспорт", "passport"],
    ["Фото", "photo"],
    ["Фото на паспорт", "photo"],
    ["Аттестат или транскрипт", "attestat"],
    ["Аттестат / диплом", "attestat"],
    ["Сертификат по языку (IELTS, TOEFL), если есть", "language_certificate"],
    ["TOEFL", "language_certificate"],
    ["Анкета / заявление", "application_form"],
    ["Чек об оплате", "payment_receipt"],
    ["Келишим", "contract"],
    ["Справка с места учёбы", "study_certificate"],
    ["Справка о несудимости", "police_certificate"],
    ["Медицинская справка", "medical"],
    ["Справка из банка", "bank_statement"],
    ["Мотивационное письмо", "motivation_letter"],
    ["Рекомендательные письма", "recommendation_letter"],
    ["Свидетельство о рождении", "birth_certificate"],
  ];
  for (const [label, typeKey] of labels) {
    assert.equal(documentGuideView({ requirementKey: null, label }, "ru")?.typeKey, typeKey, label);
  }
  assert.equal(documentGuideView({ requirementKey: "evo.passport.v1", label: "Другое" }, "ky")?.typeKey, "passport");
  assert.equal(documentGuideView({ requirementKey: "transcript", label: "Что-то" }, "ru")?.typeKey, "attestat");
  assert.equal(documentGuideView({ requirementKey: "p4.custom", label: "Паспорт" }, "ru")?.typeKey, "passport");
  assert.equal(documentGuideView({ requirementKey: null, label: "Военный билет" }, "ru"), null);
  // Похожий, но чужой документ: справки нет — чужая хуже, чем никакой.
  for (const label of [
    "Паспорт родителя", "Копия паспорта матери", "Parent passport", "Ата-эненин паспорту", "Перевод паспорта",
    "Перевод аттестата", "Апостиль на аттестат", "Аттестаттын котормосу", "Диплом олимпиады", "Выписка оценок",
    "Фото паспорта", "Фото с паспортом", "Договор аренды", "Договор с вузом", "Медицинская страховка",
    "Медицинская справка родителей", "Заявление родителей", "Анкета на визу",
  ]) {
    assert.equal(documentGuideView({ requirementKey: null, label }, "ru"), null, label);
  }
  assert.equal(documentGuideView({ requirementKey: null, label: "Фото на паспорт" }, "ru")?.typeKey, "photo");
  assert.equal(documentGuideView({ requirementKey: null, label: "Выписка из банка" }, "ru")?.typeKey, "bank_statement");
  assert.equal(documentGuideView({ requirementKey: null, label: "Bank statement" }, "ru")?.typeKey, "bank_statement");
  assert.equal(documentGuideView({ requirementKey: "other", label: "Прочее" }, "ru"), null);
  assert.equal(renderGuide({
    label: "Военный билет",
    requirementKey: null,
    locale: "ru",
    statusLabel: "Не загружен",
    statusTone: "neutral",
  }), "");
});

test("the visible «Образец и советы» button names the document and the drawer is an accessible dialog", () => {
  const html = renderGuide({
    label: "TOEFL",
    requirementKey: null,
    locale: "ru",
    statusLabel: "Не загружен",
    statusTone: "neutral",
    upload: { documentSlotId: SLOT, documentVersionId: null, originalFilename: null },
  });
  // Видимая подпись входит в доступное имя (WCAG 2.5.3), подсказка-тултип больше не нужна.
  assert.match(html, /aria-label="Образец и советы: TOEFL"/u);
  assert.match(html, /<span class="pt-doc-guide-btn-label">Образец и советы<\/span>/u);
  assert.doesNotMatch(html, /data-tooltip=/u);
  assert.match(html, /aria-haspopup="dialog"/u);
  assert.match(html, /aria-expanded="false"/u);
  const controls = html.match(/aria-controls="([^"]+)"/u);
  assert.ok(controls);
  assert.match(html, new RegExp(`id="${controls[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`, "u"));
  assert.match(html, /<dialog[^>]*aria-labelledby="/u);
  assert.match(html, /role="region"/u);
  assert.match(html, /tabindex="0"/u);
  assert.match(html, />Где взять</u);
  assert.match(html, /aria-label="Открыть образец целиком"/u);
  assert.match(html, /href="\/portal\/messages\?view=chat"/u);
  assert.match(html, /href="\/portal\?view=programs#list"/u);
  assert.match(html, />Спросить куратора</u);
  assert.match(html, /Требования конкретного вуза/u);
  assert.match(html, /type="file"/u);
  assert.match(html, />Загрузить/u);
  assert.doesNotMatch(html, /pt-doc-guide-download/u);
  assert.doesNotMatch(html, /Принятый документ доступен только для скачивания/u);
  assert.match(html, /\/portal\/document-samples\/language-score\.svg/u);
  assert.match(html, /class="pt-doc-guide-pin"/u);
  // Без страны дела — общая справка без блока страны. Отчёт теста скачивают, а не снимают: советов «Как
  // сфотографировать» нет; у бумажной справки они есть.
  assert.doesNotMatch(html, /pt-doc-guide-country/u);
  assert.doesNotMatch(html, />Как сфотографировать</u);
  const paper = renderGuide({ label: "Справка о несудимости", requirementKey: null, locale: "ru" });
  assert.match(paper, />Как сфотографировать</u);
  assert.match(paper, /Лист целиком, видны все четыре угла/u);
  // Окно крупного образца называется документом, а не действием.
  assert.match(html, /<h2 id="[^"]+" class="pt-sr-only">Образец: TOEFL<\/h2>/u);
});

test("a China case adds the curator guide requirements; other countries keep the general guide", () => {
  const cn = renderGuide({ label: "Медицинская справка", requirementKey: null, locale: "ru", country: "CN" });
  assert.match(cn, />Для Китая</u);
  assert.match(cn, /Foreigner Physical Examination Form/u);
  assert.ok(cn.indexOf("Для Китая") < cn.indexOf("Где взять"), "country requirements come before the general steps");
  const cnKy = renderGuide({ label: "Медицинская справка", requirementKey: null, locale: "ky", country: "cn" });
  assert.match(cnKy, />Кытай үчүн</u);
  const my = renderGuide({ label: "Медицинская справка", requirementKey: null, locale: "ru", country: "MY" });
  assert.doesNotMatch(my, /Для Китая|Foreigner Physical/u);
  // Для самого фото и договора с EVO советов «как сфотографировать документ» нет.
  const photo = renderGuide({ label: "Фото", requirementKey: null, locale: "ru", country: "CN" });
  assert.doesNotMatch(photo, /Как сфотографировать/u);
  assert.match(photo, /33×48 мм/u);
});

test("every China note has RU and KY in step, short lines, and no year", () => {
  for (const type of DOCUMENT_GUIDE_TYPES) {
    const ru = documentGuideView({ requirementKey: type, label: "" }, "ru", "CN");
    const ky = documentGuideView({ requirementKey: type, label: "" }, "ky", "CN");
    assert.equal(Boolean(ru.countryNotes), Boolean(ky.countryNotes), type);
    assert.equal(Boolean(ru.when), Boolean(ky.when), type);
    assert.equal(ru.where.length, ky.where.length, type);
    assert.ok(ru.where.length <= 3, type);
    if (!ru.countryNotes) continue;
    assert.equal(ru.countryNotes.items.length, ky.countryNotes.items.length, type);
    assert.ok(ru.countryNotes.items.length <= 4, type);
    assert.equal(ru.countryNotes.sections.length, ky.countryNotes.sections.length, type);
    const lines = (view) => [
      ...view.countryNotes.items,
      ...view.countryNotes.sections.flatMap((section) => [section.title, ...section.items]),
      view.description,
      ...view.where,
      view.when ?? "",
    ];
    ru.countryNotes.sections.forEach((section, index) => {
      assert.equal(section.items.length, ky.countryNotes.sections[index].items.length, `${type}: ${section.title}`);
      assert.ok(section.items.length <= 6, `${type}: ${section.title}`);
    });
    for (const line of [...lines(ru), ...lines(ky)]) {
      assert.doesNotMatch(line, /20\d\d/u, `${type}: years live in the country timeline`);
      assert.ok(line.length <= 140, `${type}: ${line}`);
    }
  }
  assert.equal(documentGuideView({ requirementKey: "passport", label: "" }, "ru").countryNotes, null);
  assert.equal(documentGuideView({ requirementKey: "passport", label: "" }, "ru").when, null);
});

test("the medical certificate for China: its own lead and steps, three titled blocks, a month", () => {
  const ru = documentGuideView({ requirementKey: null, label: "Медицинская справка" }, "ru", "CN");
  assert.match(ru.description, /Foreigner Physical Examination Form/u);
  assert.match(ru.where[0], /Скачайте и распечатайте бланк/u);
  assert.equal(ru.when, "Ноябрь–декабрь");
  assert.deepEqual(ru.countryNotes.sections.map((section) => section.title), [
    "Где пройти",
    "Анализы — рано утром натощак",
    "Проверьте перед загрузкой",
  ]);
  const general = documentGuideView({ requirementKey: null, label: "Медицинская справка" }, "ru", "MY");
  assert.doesNotMatch(general.description, /Foreigner/u);
  assert.equal(general.when, null);
});

test("the China list labels open their own guide", () => {
  const cases = [
    ["Результаты CSCA", "csca_result"],
    ["Результаты CSCA, для бакалавриата", "csca_result"],
    ["Паспорта и данные родителей", "parents_documents"],
    ["Нотариальное согласие родителей на выезд", "parental_consent"],
    ["Нотариальное согласие родителей на выезд, если вам нет 18 лет", "parental_consent"],
    ["Свидетельство о рождении", "birth_certificate"],
    ["Свидетельство о рождении, если вам нет 18 лет", "birth_certificate"],
    ["Сертификат по языку (HSK, IELTS или TOEFL)", "language_certificate"],
    ["Справка с места учёбы", "study_certificate"],
    ["Справка с места учёбы, если сейчас учитесь", "study_certificate"],
  ];
  for (const [label, type] of cases) {
    assert.equal(documentGuideView({ requirementKey: null, label }, "ru", "CN")?.typeKey, type, label);
  }
  // Похожие чужие бумаги по-прежнему без справки.
  assert.equal(documentGuideView({ requirementKey: null, label: "Паспорт отца" }, "ru", "CN"), null);
});

test("real samples: every page and blank is a small local file the proxy serves, without camera metadata", () => {
  let files = 0;
  for (const [type, sets] of Object.entries(DOCUMENT_SAMPLE_SETS)) {
    assert.ok(DOCUMENT_GUIDE_TYPES.includes(type), type);
    for (const set of sets) {
      assert.ok(set.label.ru && set.label.ky, set.id);
      for (const item of set.pages) assert.ok(item.caption.ru && item.caption.ky, `${set.id}: ${item.file}`);
      const names = [...set.pages.map((item) => item.file), ...(set.download ? [set.download.file] : [])];
      for (const name of names) {
        const href = `/portal/document-samples/${name}`;
        assert.equal(isDocumentSampleFile(href), true, href);
        const bytes = readFileSync(path.join(root, "public", href));
        assert.ok(bytes.length > 10_000 && bytes.length < 650_000, `${name}: ${bytes.length} bytes`);
        if (name.endsWith(".pdf")) {
          // Пустой бланк: в свойствах файла нет автора (остались только название и Producer macOS).
          assert.equal(bytes.includes(Buffer.from("/Author")), false, `${name} names an author`);
        } else {
          assert.equal(bytes.includes(Buffer.from("Exif")), false, `${name} carries EXIF`);
        }
        files += 1;
      }
      for (const item of set.pages) {
        const thumb = `/portal/document-samples/${item.file.replace(/\.jpg$/u, "-t.jpg")}`;
        assert.equal(isDocumentSampleFile(thumb), true, thumb);
        const bytes = readFileSync(path.join(root, "public", thumb));
        assert.ok(bytes.length > 1_000 && bytes.length < 40_000, `${thumb}: ${bytes.length} bytes`);
        assert.equal(bytes.includes(Buffer.from("Exif")), false, `${thumb} carries EXIF`);
      }
    }
  }
  assert.ok(files >= 30, `only ${files} sample files`);
});

test("country sample sets: the medical blank only for China, real passport for everyone, KY captions", () => {
  const cn = documentGuideView({ requirementKey: "medical", label: "" }, "ru", "CN");
  assert.deepEqual(cn.sampleSets.map((set) => set.id), ["medical-blank", "medical-filled"]);
  assert.equal(cn.sampleSets[0].download?.href, "/portal/document-samples/medical-blank.pdf");
  assert.equal(documentGuideView({ requirementKey: "medical", label: "" }, "ru", "MY").sampleSets.length, 0);
  const passport = documentGuideView({ requirementKey: "passport", label: "" }, "ky", null);
  assert.equal(passport.sampleSets[0].pages[0].caption, "Маалымат бети");
  assert.deepEqual(
    documentGuideView({ requirementKey: "attestat", label: "" }, "ru", "CN").sampleSets.map((set) => set.label),
    ["Аттестат", "Диплом колледжа", "Табель"],
  );
});

test("the photo memo shows the size of the student's country", () => {
  const cn = renderGuide({ label: "Фото", requirementKey: null, locale: "ru", country: "CN" });
  assert.match(cn, /33×48 мм · белый фон · 8 печатных и 1 электронное/u);
  assert.doesNotMatch(cn, /Скан напечатанного фото/u);
  const my = renderGuide({ label: "Фото", requirementKey: null, locale: "ru", country: "MY" });
  assert.match(my, /35×45 мм · белый фон · цифровой файл JPG/u);
  assert.match(my, /Скан напечатанного фото не подойдёт/u);
  const any = renderGuide({ label: "Фото", requirementKey: null, locale: "ky" });
  assert.match(any, /Ак фон · түстүү · иштетүүсүз/u);
  assert.match(any, />Туура</u);
});

test("the documents page wires the guide and drops the repeated locked subtitle", () => {
  const view = readFileSync(path.join(root, "src/components/portal/admission/DocumentsView.tsx"), "utf8");
  const files = readFileSync(path.join(root, "src/components/portal/admission/CaseFilesCard.tsx"), "utf8");
  const controls = readFileSync(path.join(root, "src/components/portal/admission/PortalDocumentControls.tsx"), "utf8");
  assert.match(view, /DocumentGuideSlot/);
  assert.match(view, /acceptedDownload/);
  assert.match(files, /DocumentGuideSlot/);
  assert.doesNotMatch(controls, /pt-doc-locked/);
  assert.doesNotMatch(view, /uploadLocked/);
  // Принятый документ не заменяется ни в строке, ни в панели — даже без файла версии.
  assert.match(view, /upload=\{document\.status === "approved" \? null : \{/u);
  assert.match(view, /allowUpload=\{document\.status !== "approved"\}/u);
});

test("an accepted document offers download in the drawer and does not open a second upload", () => {
  const html = renderGuide({
    label: "Паспорт",
    requirementKey: "passport",
    locale: "ru",
    statusLabel: "Принят",
    statusTone: "ok",
    download: {
      href: "/api/portal/document-versions/20000000-0000-4000-8000-000000000002/download",
      filename: "passport-sample.jpg",
    },
  });
  assert.match(html, /aria-label="Образец и советы: Паспорт"/u);
  assert.match(html, /class="pt-btn pt-doc-guide-download"/u);
  assert.match(html, /href="\/api\/portal\/document-versions\/20000000-0000-4000-8000-000000000002\/download"/u);
  assert.match(html, /aria-label="Скачать passport-sample\.jpg"/u);
  assert.match(html, />Принят</u);
  assert.doesNotMatch(html, /type="file"/u);
  assert.doesNotMatch(html, /Принятый документ доступен только для скачивания/u);

  const ky = renderGuide({
    label: "Келишим",
    requirementKey: "contract",
    locale: "ky",
    download: { href: "/api/portal/case-files/contract/file/download", filename: "contract.pdf" },
  });
  assert.match(ky, /aria-label="Үлгү жана кеңештер: Келишим"/u);
  assert.doesNotMatch(ky, /Кантип сүрөткө тартуу/u);
  assert.match(ky, />Кайдан алуу</u);
  assert.match(ky, />Куратордон суроо</u);
  assert.match(ky, /class="pt-btn pt-doc-guide-download"/u);
  assert.doesNotMatch(ky, /type="file"/u);
});
