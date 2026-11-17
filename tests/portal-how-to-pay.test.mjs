// «Как оплатить»: разбор текста реквизитов, сумма следующего транша, копирование и окно QR.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

import * as howToPay from "../src/lib/portal/how-to-pay.ts";
import * as portalI18n from "../src/lib/portal/i18n.ts";
import {
  amountCopyValue,
  amountToPayMinor,
  dialablePhone,
  nextUnpaidTranche,
  parseHowToPayText,
  writeCopiedText,
} from "../src/lib/portal/how-to-pay.ts";

const require = createRequire(import.meta.url);

function compile(path) {
  const code = ts.transpileModule(read(path), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const compiled = { exports: {} };
  const resolve = (id) => {
    if (id === "@/lib/portal/how-to-pay") return howToPay;
    if (id === "@/lib/portal/i18n") return portalI18n;
    return require(id);
  };
  new Function("require", "module", "exports", code)(resolve, compiled, compiled.exports);
  return compiled.exports;
}

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const { HowToPayCard } = compile("../src/components/portal/admission/HowToPayCard.tsx");
const QR = "35800000-0000-4000-8000-000000000099";
const QR_SRC = `/api/portal/case-files/payment_details_qr/${QR}/download`;
const SAMPLE = [
  "KICB (Kyrgyz Investment and Credit Bank)",
  "Получатель: Айкол Р.",
  "Телефон: +996 700 000 001",
  "Отсканируйте QR-код в любом банковском приложении",
].join("\n");

const due = (outstandingMinor, dueAt, entries = []) => ({ outstandingMinor, dueAt, currency: "KGS", entries });
const receipt = (amountMinor, status, currency = "KGS") => ({ kind: "receipt", status, amountMinor, currency });

function render(props = {}) {
  return renderToStaticMarkup(createElement(HowToPayCard, {
    text: SAMPLE,
    qrSrc: QR_SRC,
    amount: null,
    locale: "ru",
    ...props,
  }));
}

test("admin payment text becomes bank, recipient and phone without a hardcoded sample", () => {
  const parsed = parseHowToPayText(SAMPLE);
  assert.equal(parsed.structured, true);
  assert.equal(parsed.brand, "KICB");
  assert.deepEqual(parsed.fields.map((item) => [item.key, item.value, item.copyValue]), [
    ["bank", "KICB (Kyrgyz Investment and Credit Bank)", "KICB (Kyrgyz Investment and Credit Bank)"],
    ["recipient", "Айкол Р.", "Айкол Р."],
    ["phone", "+996 700 000 001", "+996700000001"],
  ]);
  assert.equal(parsed.rest, "");
  assert.equal(parseHowToPayText("Банк: KICB\nПолучатель: ЭВО\nТел.: +996 (555) 00-11").fields[2].copyValue, "+9965550011");
});

test("lines that are not bank, recipient or phone stay visible, and a free paragraph is not forced into fields", () => {
  const labeled = parseHowToPayText("Получатель: EVO Fictional\nСчёт: 0000");
  assert.equal(labeled.fields[0].value, "EVO Fictional");
  assert.equal(labeled.rest, "Счёт: 0000");
  const free = parseHowToPayText("Перевод на карту\nНазначение укажите в чате");
  assert.equal(free.structured, false);
  assert.deepEqual(free.fields, []);
  assert.match(free.rest, /Перевод на карту/);
  assert.match(free.rest, /Назначение укажите в чате/);
});

test("a phone copied for a bank app keeps the plus and drops grouping characters", () => {
  assert.equal(dialablePhone("+996 700 000 001"), "+996700000001");
  assert.equal(dialablePhone("+996-700-000-001"), "+996700000001");
  assert.equal(dialablePhone("996 700 000 001"), "996700000001");
  assert.equal(dialablePhone("без номера"), "без номера");
  assert.equal(amountCopyValue(150000), "1500");
  assert.equal(amountCopyValue(150050), "1500.50");
  assert.equal(amountCopyValue(5), "0.05");
});

test("the amount field is the earliest unpaid tranche and is hidden when nothing is outstanding", () => {
  assert.equal(nextUnpaidTranche([]), null);
  assert.equal(nextUnpaidTranche([due(0, "2026-01-01T00:00:00Z")]), null);
  const next = nextUnpaidTranche([
    due(20000, "2026-12-01T00:00:00Z"),
    due(5000, "2026-06-01T00:00:00Z"),
    due(9000, null),
  ]);
  assert.equal(next.outstandingMinor, 5000);
  assert.equal(next.dueAt, "2026-06-01T00:00:00Z");
  const undated = nextUnpaidTranche([due(8000, null), due(1000, null)]);
  assert.equal(undated.outstandingMinor, 8000);
});

test("writeCopiedText uses the clipboard and falls back only after it refuses", async () => {
  const written = [];
  assert.equal(await writeCopiedText("+996700000001", {
    writeText: async (value) => { written.push(value); },
    fallback: () => { throw new Error("fallback must not run"); },
  }), true);
  assert.deepEqual(written, ["+996700000001"]);

  let fallback = "";
  assert.equal(await writeCopiedText("1500", {
    writeText: async () => { throw new Error("denied"); },
    fallback: (value) => { fallback = value; return true; },
  }), true);
  assert.equal(fallback, "1500");
  assert.equal(await writeCopiedText("1500", {
    writeText: async () => { throw new Error("denied"); },
    fallback: () => false,
  }), false);
  assert.equal(await writeCopiedText("1500", {}), false);
});

test("the card renders copyable fields, a large QR and no amount when nothing is due", () => {
  const html = render();
  assert.match(html, /Как оплатить/);
  assert.match(html, /data-testid="portal-how-to-pay-bank"/);
  assert.match(html, /KICB \(Kyrgyz Investment and Credit Bank\)/);
  assert.match(html, /data-testid="portal-how-to-pay-phone"/);
  assert.match(html, /\+996 700 000 001/);
  assert.match(html, /aria-label="Скопировать номер телефона"/);
  assert.match(html, /data-copy-value="\+996700000001"/);
  assert.match(html, /aria-label="Скопировать банк"/);
  assert.match(html, /aria-label="Скопировать получателя"/);
  assert.doesNotMatch(html, /data-testid="portal-how-to-pay-amount"/);
  assert.match(html, new RegExp(`src="${QR_SRC}"`));
  assert.match(html, /class="pt-howtopay-qr"/);
  assert.match(html, /width="240"/);
  assert.match(html, /class="pt-howtopay-qr-brand">KICB</);
  assert.match(html, />Скачать QR</);
  // Одна ссылка «Скачать QR» на всех ширинах: на iPhone загрузка уходит в «Файлы», а не в «Фото».
  assert.doesNotMatch(html, /галере/u);
  assert.match(html, />Открыть на весь экран</);
  assert.match(html, /Оплатили\? Приложите чек/);
  assert.doesNotMatch(html, /Отсканируйте QR-код/);
  assert.doesNotMatch(html, /<ol\b/);
  assert.doesNotMatch(html, /<dialog[^>]*\sopen/u);
  assert.match(html, /role="status"/);
  assert.match(html, /aria-live="polite"/);
});

test("the amount field and the copied confirmation appear only when there is something to show", () => {
  const withAmount = render({
    amount: { display: "15\u00A0000\u00A0сом", dueOn: "20.01.2027", copyValue: "15000", overdue: false },
  });
  assert.match(withAmount, /data-testid="portal-how-to-pay-amount"/);
  assert.match(withAmount, /Сумма к оплате/);
  assert.match(withAmount, /15\u00A0000\u00A0сом/);
  assert.match(withAmount, /до 20\.01\.2027/);
  const overdue = render({
    amount: { display: "15\u00A0000\u00A0сом", dueOn: "01.11.2026", copyValue: "15000", overdue: true },
  });
  assert.match(overdue, /просрочено, срок был 01\.11\.2026/);
  assert.doesNotMatch(overdue, /до 01\.11\.2026/);
  assert.match(withAmount, /data-copy-value="15000"/);
  assert.match(withAmount, /aria-label="Скопировать сумму"/);

  const copied = render({ initialFeedback: { key: "phone", ok: true } });
  assert.match(copied, /class="pt-howtopay-copied">Скопировано/);
  const failed = render({ initialFeedback: { key: "phone", ok: false } });
  assert.match(failed, /class="pt-howtopay-copy-error">Не удалось скопировать/);

  const ky = render({ locale: "ky", initialFeedback: { key: "recipient", ok: true } });
  assert.match(ky, />Алуучу</);
  assert.match(ky, /Көчүрүлдү/);
  assert.match(ky, /Телефон номерин көчүрүү/);
});

test("the QR dialog is closed until opened and then shows a large code with a close button", () => {
  const html = render({ previewOpen: true });
  assert.match(html, /<dialog\b[^>]*\bopen\b/u);
  assert.match(html, /class="pt-howtopay-dialog-qr"/);
  assert.match(html, /width="480"/);
  assert.match(html, /aria-label="Закрыть"/);
  assert.match(html, /aria-haspopup="dialog"/);
  const source = read("../src/components/portal/admission/HowToPayCard.tsx");
  assert.match(source, /showModal\(\)/);
  assert.match(source, /onClose=\{\(\) => opener\.current\?\.focus\(\)\}/);
  assert.doesNotMatch(source, /Айкол|700 000 001|Kyrgyz Investment/);
});

test("an account line that is not one of the three fields is still on the card", () => {
  const html = render({
    text: "Получатель: EVO Fictional\nСчёт: 0000",
    qrSrc: null,
    amount: null,
  });
  assert.match(html, /EVO Fictional/);
  assert.match(html, /Счёт: 0000/);
  assert.doesNotMatch(html, /pt-howtopay-qr/);
  assert.doesNotMatch(html, /Скачать QR/);
});

test("several phones in one line copy the first number, not glued digits", () => {
  assert.equal(dialablePhone("+996 700 000 001 / +996 700 000 002"), "+996700000001");
  assert.equal(dialablePhone("+996 700 000 001 или +996 700 000 002"), "+996700000001");
  assert.equal(dialablePhone("+996 700 000 001, 0700 000 002"), "+996700000001");
  assert.equal(dialablePhone("доб. 12"), "доб. 12");
});

test("requisite lines are never lost and a card number is not labelled as a phone", () => {
  const withAccount = parseHowToPayText("Банк: Тестбанк\nПолучатель: Тест\nСчёт 1234 5678 (оплата по QR-коду)");
  assert.match(withAccount.rest, /Счёт 1234 5678/u);
  const card = parseHowToPayText("Банк: Тестбанк\nНомер: 4000 0000 0000 0001");
  assert.equal(card.fields.some((item) => item.key === "phone"), false);
  assert.match(card.rest, /Номер: 4000 0000 0000 0001/u);
  const phone = parseHowToPayText("Банк: Тестбанк\nНомер телефона: +996 700 000 001");
  assert.equal(phone.fields.find((item) => item.key === "phone")?.copyValue, "+996700000001");
  const dashed = parseHowToPayText("Банк - Тестбанк\nПолучатель — Тест");
  assert.deepEqual(dashed.fields.map((item) => [item.key, item.value]), [["bank", "Тестбанк"], ["recipient", "Тест"]]);
  assert.equal(dashed.brand, "Тестбанк");
});

test("the amount to pay leaves out receipts the curator is still checking", () => {
  assert.equal(amountToPayMinor(due(15000, null, [receipt(5000, "review")])), 10000);
  assert.equal(amountToPayMinor(due(15000, null, [receipt(5000, "accepted"), receipt(5000, "rejected")])), 15000);
  assert.equal(amountToPayMinor(due(15000, null, [receipt(5000, "review", "USD")])), 15000);
  assert.equal(amountToPayMinor(due(15000, null, [receipt(20000, "review")])), 0);
  const next = nextUnpaidTranche([
    due(15000, "2026-06-01T00:00:00Z", [receipt(15000, "review")]),
    due(9000, "2026-12-01T00:00:00Z"),
  ]);
  assert.equal(next.outstandingMinor, 9000);
});
