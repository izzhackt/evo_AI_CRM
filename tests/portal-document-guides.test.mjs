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
  documentGuideCountry,
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
  // 23.11.2026: у сертификата по языку свои нарисованные образцы вместо схемы; без страны — один IELTS (HSK — для Китая).
  assert.match(html, /aria-label="Открыть образец целиком: IELTS, Пример, данные вымышлены"/u);
  assert.doesNotMatch(html, /aria-pressed="(?:true|false)">HSK</u);
  assert.match(html, /href="\/portal\/messages\?view=chat"/u);
  assert.match(html, /href="\/portal\?view=programs#list"/u);
  assert.match(html, />Спросить куратора</u);
  assert.match(html, /Требования конкретного вуза/u);
  assert.match(html, /type="file"/u);
  assert.match(html, />Загрузить/u);
  assert.doesNotMatch(html, /pt-doc-guide-download/u);
  assert.doesNotMatch(html, /Принятый документ доступен только для скачивания/u);
  assert.match(html, /\/portal\/document-samples\/ielts-1\.jpg/u);
  // Документ без наборов по-прежнему показывает нарисованную схему с метками.
  const scheme = renderGuide({ label: "Медицинская справка", requirementKey: null, locale: "ru" });
  assert.match(scheme, /\/portal\/document-samples\/medical\.svg/u);
  assert.match(scheme, /class="pt-doc-guide-pin"/u);
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

// 373 (23.11.2026): справка следует стране дела, где лежит документ, а не выбору студента на «Главной».
test("each document's help follows the country of its case; an unknown case falls back to the student's choice", () => {
  const caseCountries = new Map([["case-cn", "CN"], ["case-my", "MY"]]);
  assert.equal(documentGuideCountry("case-cn", caseCountries, "MY"), "CN", "the case wins over the choice");
  assert.equal(documentGuideCountry("case-my", caseCountries, "CN"), "MY", "two cases, two countries: each row its own");
  assert.equal(documentGuideCountry("case-unknown", caseCountries, "MY"), "MY", "an unknown case: the choice");
  assert.equal(documentGuideCountry("case-cn", new Map(), null), null, "a failed read and no choice: the general help");

  const page = readFileSync(path.join(root, "src/app/(portal)/portal/documents/page.tsx"), "utf8");
  assert.match(page, /import \{ readStudentPortalCaseDirections \} from "@\/lib\/v3\/portal-source"/u);
  assert.match(page, /const \[caseFiles, country, caseCountries\] = await Promise\.all\(\[caseFilesRead, countryRead, directionsRead\]\);/u);
  assert.match(page, /<DocumentsView documents=\{documents\} locale=\{locale\} country=\{country\} caseCountries=\{caseCountries\} \/>/u);
  const view = readFileSync(path.join(root, "src/components/portal/admission/DocumentsView.tsx"), "utf8");
  assert.match(view, /const guideCountry = documentGuideCountry\(document\.caseId, caseCountries, country\);/u);
  assert.match(view, /country=\{guideCountry\}/u);

  const source = readFileSync(path.join(root, "src/lib/v3/portal-source.ts"), "utf8");
  const reader = source.slice(source.indexOf("export async function readStudentPortalCaseDirections"));
  assert.match(reader, /rpc\("student_portal_case_directions_v1", \{\}, \{ get: true \}\)/u);
  assert.match(reader.slice(0, reader.indexOf("\n}\n")), /catch \{\s+return new Map\(\);/u, "a failed read never breaks the page");
});

test("migration 373: the student reads only their own cases, with the 338 country rule, and nothing else is opened", () => {
  const sql = readFileSync(path.join(root, "supabase/migrations/373_platform_student_case_direction.sql"), "utf8");
  // The rule is the one that seeded the checklist (338), in the same order.
  const seed = readFileSync(path.join(root, "supabase/migrations/338_platform_default_document_checklist.sql"), "utf8");
  assert.match(seed, /direction := target_case\.admissions_direction;/u);
  assert.match(seed, /platform_private\.student_application_direction\(upper\(btrim\(target_case\.target_country\)\)\)/u);
  assert.match(sql, /COALESCE\(\s+student_case\.admissions_direction,\s+platform_private\.student_application_direction\(upper\(btrim\(student_case\.target_country\)\)\),/u);
  assert.match(sql, /application\.student_case_id = p_student_case_id OR application\.invited_case_id = p_student_case_id\)\s+ORDER BY application\.submitted_at DESC NULLS LAST, application\.id DESC/u);
  // The read: the signed-in student, own cases with a portal, the same checks as 357; only id and country come back.
  assert.match(sql, /RETURNS TABLE\(student_case_id UUID, direction TEXT\)/u);
  assert.match(sql, /student_profile\.auth_user_id = \(SELECT auth\.uid\(\)\)/u);
  assert.match(sql, /private\.platform_can_read_student_portal_case\(student_case\.organization_id, student_case\.id\)/u);
  assert.match(sql, /student_case\.portal_activated_at IS NOT NULL/u);
  assert.match(sql, /REVOKE ALL ON FUNCTION platform_private\.student_case_direction\(UUID, UUID\)\s+FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;/u);
  assert.match(sql, /REVOKE ALL ON FUNCTION platform\.student_portal_case_directions_v1\(\) FROM PUBLIC, anon, service_role, supabase_auth_admin;/u);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION platform\.student_portal_case_directions_v1\(\) TO authenticated;/u);
  assert.equal((sql.match(/SECURITY DEFINER SET search_path = ''/gu) ?? []).length, 2);
  assert.doesNotMatch(sql, /INSERT INTO|UPDATE platform|DELETE FROM|audit_events/u, "a read only");
  assert.match(sql, /RAISE EXCEPTION 'a373_already_applied'/u);
  // The real-Postgres proof runs right after the migration, by file name.
  const runner = readFileSync(path.join(root, "scripts/test-runners/test-postgres-authorization.sh"), "utf8");
  assert.match(runner, /== \*_platform_student_case_direction\.sql \]\]; then/u);
  assert.match(runner, /grep -Fq "a373_already_applied"/u);
  assert.match(runner, /A373_STUDENT_CASE_DIRECTION_SUITE_PASSED/u);
  const suite = readFileSync(path.join(root, "supabase/tests/platform_student_case_direction.sql"), "utf8");
  assert.match(suite, /^BEGIN;$/mu);
  assert.match(suite, /^ROLLBACK;\s*$/mu);
  assert.match(suite, /\\echo A373_STUDENT_CASE_DIRECTION_SUITE_PASSED/u);
  assert.doesNotMatch(suite, /@(?!example\.invalid)[a-z0-9-]+\.[a-z]/iu, "synthetic addresses only");
});

// 23.11.2026: недостающие образцы нарисованы нами — вымышленные данные, подпись говорит об этом на RU и KY.
test("drawn specimens: bank, language tests, CSCA and birth certificate say they are fictional", () => {
  for (const type of ["bank_statement", "language_certificate", "csca_result", "birth_certificate"]) {
    const sets = DOCUMENT_SAMPLE_SETS[type];
    assert.ok(sets && sets.length > 0, type);
    for (const set of sets) {
      assert.ok(set.label.ru && set.label.ky, `${type}: ${set.id}`);
      for (const page of set.pages) {
        // У CSCA официального образца нет нигде: подпись говорит, что вид примерный.
        const caption = type === "csca_result"
          ? { ru: "Примерный вид, данные вымышлены", ky: "Болжолдуу көрүнүшү, маалыматтар ойдон чыгарылган" }
          : { ru: "Пример, данные вымышлены", ky: "Үлгү, маалыматтар ойдон чыгарылган" };
        assert.deepEqual(page.caption, caption, `${type}: ${page.file}`);
        assert.ok(existsSync(path.join(root, "public/portal/document-samples", page.file)), page.file);
        assert.ok(existsSync(path.join(root, "public/portal/document-samples", page.file.replace(/\.jpg$/u, "-t.jpg"))), page.file);
      }
    }
  }
  assert.deepEqual(DOCUMENT_SAMPLE_SETS.language_certificate.map((set) => set.id), ["ielts", "hsk"]);
  // HSK — только в деле Китая: у Малайзии и без страны остаётся один IELTS.
  const languageSets = (country) => documentGuideView({ requirementKey: "language_certificate", label: "" }, "ru", country)
    .sampleSets.map((set) => set.label);
  assert.deepEqual(languageSets("CN"), ["IELTS", "HSK"]);
  assert.deepEqual(languageSets("MY"), ["IELTS"]);
  assert.deepEqual(languageSets(null), ["IELTS"]);
  // Исходники лежат рядом и перерисовываются одной командой; в исходниках только вымышленные данные.
  const dir = path.join(root, "scripts/portal/document-specimens");
  for (const name of ["bank-statement", "ielts", "hsk", "csca", "birth-certificate"]) {
    const html = readFileSync(path.join(dir, `${name}.html`), "utf8");
    assert.match(html, /ОБРАЗЕЦ/u, name);
    assert.doesNotMatch(html, /<img\b|https?:\/\//u, `${name}: no outside images or links`);
  }
  assert.match(readFileSync(path.join(dir, "render.mjs"), "utf8"), /public\/portal\/document-samples/u);
});
