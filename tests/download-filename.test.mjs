import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDownloadFilename,
  buildStoredDownloadFilename,
  parseContentDispositionFilename,
} from "../src/lib/download-filename.ts";

test("type and surname with extension from MIME", () => {
  assert.equal(buildDownloadFilename({ label: "Паспорт", surname: "Фамилия", mimeType: "image/jpeg" }), "Паспорт — Фамилия.jpg");
  assert.equal(buildDownloadFilename({ label: "Договор", surname: "Фамилия", mimeType: "application/pdf" }), "Договор — Фамилия.pdf");
  assert.equal(buildDownloadFilename({ label: "Чек", surname: "Фамилия", mimeType: "image/png" }), "Чек — Фамилия.png");
  assert.equal(buildDownloadFilename({ label: "Аттестат", surname: "Фамилия", mimeType: "IMAGE/JPEG; charset=x" }), "Аттестат — Фамилия.jpg");
});

test("extension falls back to the original name, lower-cased", () => {
  assert.equal(buildDownloadFilename({ label: "Паспорт", surname: "Фамилия", mimeType: "application/x-unknown", fallbackName: "scan 1.HEIC" }), "Паспорт — Фамилия.heic");
  assert.equal(buildDownloadFilename({ label: "Паспорт", surname: "Фамилия" }), "Паспорт — Фамилия");
});

test("missing parts degrade to label alone, then the original name, never empty", () => {
  assert.equal(buildDownloadFilename({ label: "Паспорт", mimeType: "application/pdf" }), "Паспорт.pdf");
  assert.equal(buildDownloadFilename({ label: " ", surname: "", mimeType: "application/pdf", fallbackName: "Справка о доходах.pdf" }), "Справка о доходах.pdf");
  assert.equal(buildDownloadFilename({ mimeType: "application/pdf" }), "Документ.pdf");
  assert.equal(buildDownloadFilename({ surname: "Фамилия", mimeType: "application/pdf" }), "Документ — Фамилия.pdf");
  assert.equal(buildDownloadFilename({}), "Документ");
  assert.equal(buildDownloadFilename({ label: null, surname: null, mimeType: null, fallbackName: null }), "Документ");
});

test("dangerous and control characters are removed, whitespace collapsed, dots trimmed", () => {
  const name = buildDownloadFilename({ label: "  Пас/порт\\: *?\"<>|\n\t ", surname: "..Фамилия.. ", mimeType: "image/png" });
  assert.equal(name, "Пас порт — Фамилия.png");
  assert.doesNotMatch(name, /[\u0000-\u001f/\\:*?"<>|]/u);
  assert.equal(buildDownloadFilename({ label: "..", surname: "/", mimeType: "image/png", fallbackName: "../../etc/passwd.png" }), "etc passwd.png");
  assert.equal(buildDownloadFilename({ label: "A‮exe.pdf", surname: "B\u0000", mimeType: "application/pdf" }), "A exe.pdf — B.pdf");
});

test("a very long stem is capped and never ends with a dot or space", () => {
  const name = buildDownloadFilename({ label: "Очень длинный тип документа ".repeat(20), surname: "Фамилия", mimeType: "application/pdf" });
  const stem = name.slice(0, -4);
  assert.ok(Array.from(stem).length <= 120);
  assert.ok(name.endsWith(".pdf"));
  assert.doesNotMatch(stem, /[\s.]$/u);
});

test("the storage key is never produced from the original name alone", () => {
  assert.equal(buildDownloadFilename({ label: "Паспорт", surname: "Фамилия", mimeType: "application/pdf", fallbackName: "ab/" + "c".repeat(62) }), "Паспорт — Фамилия.pdf");
});

test("stored names for company files and chat media", () => {
  assert.equal(buildStoredDownloadFilename({ name: "Прайс 2026.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "Прайс 2026.xlsx");
  assert.equal(buildStoredDownloadFilename({ name: "voice", mimeType: "audio/ogg" }), "voice.ogg");
  assert.equal(buildStoredDownloadFilename({ name: "a/b\\c.PDF", mimeType: "" }), "a b c.pdf");
  assert.equal(buildStoredDownloadFilename({ name: "", mimeType: "application/pdf" }), "Документ.pdf");
});

test("Content-Disposition: RFC 5987 name wins over the ASCII fallback", () => {
  const header = `attachment; filename="_______ — _______.jpg"; filename*=UTF-8''%D0%9F%D0%B0%D1%81%D0%BF%D0%BE%D1%80%D1%82%20%E2%80%94%20%D0%A4%D0%B0%D0%BC%D0%B8%D0%BB%D0%B8%D1%8F.jpg`;
  assert.equal(parseContentDispositionFilename(header), "Паспорт — Фамилия.jpg");
  assert.equal(parseContentDispositionFilename('attachment; filename="plain.pdf"'), "plain.pdf");
  assert.equal(parseContentDispositionFilename("attachment;"), null);
  assert.equal(parseContentDispositionFilename(null), null);
});

test("Content-Disposition: broken or hostile values fall back, never throw", () => {
  assert.equal(parseContentDispositionFilename(`attachment; filename="safe.pdf"; filename*=UTF-8''%E0%A4%A`), "safe.pdf");
  assert.equal(parseContentDispositionFilename(`attachment; filename*=UTF-8''..%2Fevil.pdf`), null);
  assert.equal(parseContentDispositionFilename(`attachment; filename*=UTF-8''a%0Ab.pdf; filename="ok.pdf"`), "ok.pdf");
  assert.equal(parseContentDispositionFilename(`attachment; filename*=ISO-8859-1''%C4.pdf; filename="ok.pdf"`), "ok.pdf");
});
