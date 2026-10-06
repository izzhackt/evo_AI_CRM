// «ИИ-агент» P2 (docs/EVO_AI_AGENT_PLAN_2026-10-06.md §4.5, §7, §8, §12.2, §15):
// CRM-сторона — загрузка файла (размер, тип, сигнатура, ClamAV, Storage, RPC),
// картинки страниц и вырезки, внутренний брокер Storage агента (HMAC своего
// секрета, аренда документа в базе, только GET оригинала/страниц и PUT
// страниц/вырезок), маршруты Лаборатории (билеты laboratory / lab_apply,
// поток SSE и JSON агента), контракт прокси, чистый контракт интерфейса и
// необязательный секрет брокера в контракте env. Агент — поддельный
// HTTP-сервер этого теста; ClamAV, Storage и база — подделки с записью
// вызовов. Данные синтетические, ни одного вызова Google. Что сотрудник может
// читать и менять, решает база (271–273, supabase/tests в ветке P2 SQL).
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { build } from "esbuild";
import { NextRequest } from "next/server.js";
import PizZip from "pizzip";
import sharp from "sharp";

import {
  AI_AGENT_SECTIONS,
  aiAgentHref,
  documentStatus,
  parseAiAgentRoute,
} from "../src/lib/v3/ai-agent.ts";
import {
  AI_UPLOAD_FORMATS,
  AI_UPLOAD_MAX_BYTES,
  aiCropHref,
  aiPageImageHref,
  aiTitleFromFileName,
  aiUploadErrorCopy,
  aiUploadRetryable,
  checkAiUploadFile,
  isAiReviewCorrection,
  normalizeAiBox,
  normalizeAiDocumentDetail,
  normalizeAiDocumentPage,
  normalizeAiExamples,
  normalizeAiLabState,
  normalizeAiReviewList,
  parseAiLabStreamEvent,
} from "../src/lib/v3/ai-agent-knowledge.ts";
import {
  aiDocumentIdForRequest,
  checkAiUploadContent,
  pngSize,
} from "../src/lib/server/ai-agent-files.ts";
import {
  createAiDocumentPageImageHandler,
  createAiDocumentUploadHandler,
  createAiLabApplyHandler,
  createAiLabAskHandler,
  createAiLabCritiqueHandler,
  createAiLabStateHandler,
  createAiReviewCropHandler,
} from "../src/lib/server/ai-agent-knowledge-route-handlers.ts";
import {
  createAiStorageBrokerHandler,
  parseAiBrokerPath,
  readAiStorageSecret,
  signAiStorageRequest,
} from "../src/lib/server/ai-agent-storage-broker.ts";
import { removeAiDocumentObjects } from "../src/lib/server/ai-agent-storage-cleanup.ts";
import { ClamdScanError } from "../src/lib/server/clamd-malware-scanner.ts";
import {
  isConnectedPlatformApi,
  isConnectedPlatformPage,
  isConnectedPlatformPrivateApi,
  isRetiredPlatformRoute,
} from "../src/lib/platform-route-contract.ts";
import { validateAppEnvironmentContract } from "../scripts/evo-app-env-contract.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const ID = (n) => `27200000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const UPPER_ID = "ABCDEF00-0000-4000-8000-0000000000AA";
const ORG = ID(90);
const ACTOR = Object.freeze({ organizationId: ORG, membershipId: ID(91) });
const SECRET = "s".repeat(24) + "-synthetic-ai-agent-secret";
const STORAGE_SECRET = "b".repeat(24) + "-synthetic-storage-broker-secret";
const TICKET = "c3".repeat(32);
const origin = { origin: "https://crm.test", host: "crm.test" };

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// ------------------------------------------------------------ fixtures (synthetic)

function ooxml(kind, extra = {}) {
  const zip = new PizZip();
  const main = kind === "docx" ? "word/document.xml" : "xl/workbook.xml";
  const type = kind === "docx"
    ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"
    : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml";
  zip.file("[Content_Types].xml", `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/${main}" ContentType="${extra.mainType ?? type}"/></Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="${main}"/></Relationships>`);
  zip.file(main, kind === "docx"
    ? `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Политика возвратов (синтетика)</w:t></w:r></w:p></w:body></w:document>`
    : `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets/></workbook>`);
  for (const [name, contents] of Object.entries(extra.files ?? {})) zip.file(name, contents);
  return zip.generate({ type: "uint8array", compression: "DEFLATE" });
}
const pdf = () => new TextEncoder().encode("%PDF-1.7\n% синтетический прайс\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
const png = (width = 8, height = 8) => sharp({ create: { width, height, channels: 3, background: "#ffffff" } }).png().toBuffer().then((buffer) => new Uint8Array(buffer));
const jpeg = () => sharp({ create: { width: 8, height: 8, channels: 3, background: "#ffffff" } }).jpeg().toBuffer().then((buffer) => new Uint8Array(buffer));
const fmt = (kind, mime) => AI_UPLOAD_FORMATS.find((format) => format.kind === kind && (!mime || format.mimeType === mime));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const proof = (bytes) => ({
  engine: "ClamAV", engineVersion: "1.4.3", signatureVersion: "27400", protocol: "clamd-zinstream-v1",
  scannedAt: new Date().toISOString(), sha256Hex: sha(bytes),
});

// ------------------------------------------------------------ pure contract

test("route: sections are real links; document, page, chunk, replace and review filters are strict", () => {
  assert.deepEqual(AI_AGENT_SECTIONS.map((section) => section.title),
    ["Информация для агента", "Лист сверки", "Лаборатория", "Правила общения", "Расходы"]);
  assert.equal(parseAiAgentRoute({})?.section, "documents");
  assert.equal(parseAiAgentRoute({ section: "documents" })?.section, "documents");
  assert.deepEqual(parseAiAgentRoute({ document: ID(1).toUpperCase(), page: "3", chunk: "42" }),
    { section: "documents", documentId: ID(1), page: 3, chunkId: 42, replaceId: null, reviewFilter: "open" });
  assert.equal(parseAiAgentRoute({ section: "review", status: "resolved", document: ID(2) })?.reviewFilter, "resolved");
  assert.equal(parseAiAgentRoute({ section: "review", status: "dismissed" })?.reviewFilter, "dismissed");
  assert.equal(parseAiAgentRoute({ section: "lab" })?.section, "lab");
  for (const query of [
    { section: "laboratory" }, { section: "lab", document: ID(1) }, { page: "2" }, { document: ID(1), page: "0" },
    { document: ID(1), page: "301" }, { document: "nope" }, { replace: ID(1), document: ID(2) }, { section: "review", status: "open" },
    { section: "review", page: "1" }, { section: "spend", replace: ID(1) }, { section: ["lab", "rules"] }, { extra: "1" },
    { document: ID(1), chunk: "-1" },
  ]) assert.equal(parseAiAgentRoute(query), null, JSON.stringify(query));
  assert.equal(aiAgentHref("documents", { document: ID(1), page: 2, chunk: null }), `/v3/ai-agent?document=${ID(1)}&page=2`);
  assert.equal(aiAgentHref("review", { status: "resolved" }), "/v3/ai-agent?section=review&status=resolved");
});

test("statuses: queued, processing with stage and percent, review count, ready, Russian error, personal document", () => {
  const base = { stage: null, progress: 0, errorCode: null, openReviewCount: 0 };
  assert.deepEqual(documentStatus({ ...base, status: "queued" }), { label: "В очереди", tone: "muted" });
  assert.deepEqual(documentStatus({ ...base, status: "processing", stage: "ocr", progress: 40 }), { label: "Обработка · распознавание 40%", tone: "muted" });
  assert.deepEqual(documentStatus({ ...base, status: "processing" }), { label: "Обработка", tone: "muted" });
  assert.deepEqual(documentStatus({ ...base, status: "review", openReviewCount: 3 }), { label: "Нужна сверка · 3", tone: "warn" });
  assert.deepEqual(documentStatus({ ...base, status: "ready" }), { label: "Готов", tone: "ok" });
  assert.deepEqual(documentStatus({ ...base, status: "failed", errorCode: "file_encrypted" }), { label: "Ошибка — файл защищён паролем", tone: "danger" });
  assert.deepEqual(documentStatus({ ...base, status: "failed", errorCode: "something_new" }), { label: "Ошибка — не удалось обработать", tone: "danger" });
  assert.deepEqual(documentStatus({ ...base, status: "failed", errorCode: "personal_document_suspected" }),
    { label: "Похоже на документ клиента — не загружается", tone: "warn" });
});

test("upload check: extension, declared type and size agree; macro and legacy Office are refused", () => {
  assert.equal(checkAiUploadFile("Прайс 2026.xlsx", XLSX, 1000).ok, true);
  assert.equal(checkAiUploadFile("заметки.md", "", 10).ok, true, "an empty declared type is «unknown», not a mismatch");
  assert.equal(checkAiUploadFile("export.csv", "application/vnd.ms-excel", 10).ok, true, "Windows names CSV as Excel");
  assert.equal(checkAiUploadFile("scan.JPEG", "image/jpeg", 10).ok, true);
  assert.deepEqual(checkAiUploadFile("a.pdf", "application/pdf", 0), { ok: false, code: "empty" });
  assert.deepEqual(checkAiUploadFile("a.pdf", "application/pdf", AI_UPLOAD_MAX_BYTES + 1), { ok: false, code: "too_large" });
  assert.deepEqual(checkAiUploadFile("a.docm", "", 10), { ok: false, code: "macro" });
  assert.deepEqual(checkAiUploadFile("a.xls", "application/vnd.ms-excel", 10), { ok: false, code: "macro" });
  assert.deepEqual(checkAiUploadFile("a.exe", "", 10), { ok: false, code: "unsupported_type" });
  assert.deepEqual(checkAiUploadFile("noext", "", 10), { ok: false, code: "unsupported_type" });
  assert.deepEqual(checkAiUploadFile("a.pdf", "image/png", 10), { ok: false, code: "type_mismatch" });
  assert.equal(aiTitleFromFileName("Прайс_2026__Малайзия.xlsx"), "Прайс 2026 Малайзия");
  assert.equal(aiUploadErrorCopy("duplicate", "Прайс 2026"), "Этот файл уже загружен: «Прайс 2026».");
  assert.equal(aiUploadErrorCopy("malware_detected"), "Файл не прошёл проверку на вирусы.");
  assert.equal(isAiReviewCorrection("1 250,00 $"), true);
  assert.equal(isAiReviewCorrection("1\n2"), false);
  assert.equal(isAiReviewCorrection("x".repeat(201)), false);
});

test("content: magic bytes, OOXML package without macros, UTF-8 or cp1251 text without NUL", async () => {
  assert.deepEqual(checkAiUploadContent(fmt("pdf"), pdf()), { ok: true });
  assert.deepEqual(checkAiUploadContent(fmt("pdf"), new TextEncoder().encode("%PDF")), { ok: false, code: "content_mismatch" });
  assert.deepEqual(checkAiUploadContent(fmt("image", "image/png"), await png()), { ok: true });
  assert.deepEqual(checkAiUploadContent(fmt("image", "image/png"), await jpeg()), { ok: false, code: "content_mismatch" });
  assert.deepEqual(checkAiUploadContent(fmt("image", "image/jpeg"), await jpeg()), { ok: true });
  assert.deepEqual(checkAiUploadContent(fmt("docx"), ooxml("docx")), { ok: true });
  assert.deepEqual(checkAiUploadContent(fmt("xlsx"), ooxml("xlsx")), { ok: true });
  assert.deepEqual(checkAiUploadContent(fmt("docx"), ooxml("xlsx")), { ok: false, code: "content_mismatch" }, "a workbook renamed .docx");
  assert.deepEqual(checkAiUploadContent(fmt("docx"), ooxml("docx", { files: { "word/vbaProject.bin": "x" } })), { ok: false, code: "macro" });
  assert.deepEqual(checkAiUploadContent(fmt("xlsx"), ooxml("xlsx", { files: { "xl/activeX/activeX1.xml": "<x/>" } })), { ok: false, code: "macro" });
  assert.deepEqual(checkAiUploadContent(fmt("xlsx"), ooxml("xlsx", { mainType: "application/vnd.ms-excel.sheet.macroEnabled.main+xml" })),
    { ok: false, code: "content_mismatch" }, "an .xlsm renamed .xlsx");
  assert.deepEqual(checkAiUploadContent(fmt("docx"), pdf()), { ok: false, code: "content_mismatch" });
  const text = fmt("text", "text/plain");
  assert.deepEqual(checkAiUploadContent(text, new TextEncoder().encode("Цены: 1 250,00 $\n")), { ok: true });
  assert.deepEqual(checkAiUploadContent(text, Uint8Array.from([0xd6, 0xe5, 0xed, 0xfb, 0x0d, 0x0a])), { ok: true }, "«Цены» in cp1251");
  assert.deepEqual(checkAiUploadContent(text, Uint8Array.from([0x41, 0x00, 0x42])), { ok: false, code: "text_encoding" });
  assert.deepEqual(checkAiUploadContent(text, Uint8Array.from([0xd6, 0x01, 0x98])), { ok: false, code: "text_encoding" });
});

test("document id: one per (organization, request, file bytes), UUID v4 shape", () => {
  const A = "a".repeat(64), B = "b".repeat(64);
  const id = aiDocumentIdForRequest(ORG, ID(7), A);
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
  assert.equal(aiDocumentIdForRequest(ORG, ID(7), A), id, "a replay of the same request with the same bytes lands on the same object and receipt");
  assert.notEqual(aiDocumentIdForRequest(ORG, ID(7), B), id, "other bytes under the same request id never reuse the stored object");
  assert.notEqual(aiDocumentIdForRequest(ORG, ID(8), A), id);
  assert.notEqual(aiDocumentIdForRequest(ID(89), ID(7), A), id);
});

test("normalizers: page paths stay on the server, boxes are fractions, review readings and lab state are strict", () => {
  assert.deepEqual(normalizeAiBox([0.1, 0.2, 0.5, 0.3]), { x0: 0.1, y0: 0.2, x1: 0.5, y1: 0.3 });
  assert.deepEqual(normalizeAiBox({ x: 0.1, y: 0.1, w: 0.2, h: 0.1 }), { x0: 0.1, y0: 0.1, x1: 0.30000000000000004, y1: 0.2 });
  assert.equal(normalizeAiBox([0.5, 0.5, 0.4, 0.6]), null);
  assert.equal(normalizeAiBox([10, 20, 30, 40]), null, "pixels are not fractions");
  const document = { id: ID(1), title: "Прайс 2026", kind: "pdf", audience: "client", status: "review", source: "upload", sourceRef: {},
    rowVersion: 4, docVersion: 2, replacesId: ID(9), updatedAt: "2026-10-06T08:00:00Z", openReviewCount: 2, chunkCount: 30, pageCount: 3 };
  const detail = normalizeAiDocumentDetail({ document, canManage: true, pages: [
    { pageNo: 1, method: "text", imagePath: `${ORG}/${ID(1)}/pages/1.png`, openReviewCount: 0 },
    { pageNo: 2, method: "ocr", hasImage: true, openReviewCount: 2 },
  ] });
  assert.equal(detail.document.replacesId, ID(9));
  assert.deepEqual(detail.pages.map((page) => [page.pageNo, page.hasImage, page.method]), [[1, true, "text"], [2, true, "ocr"]]);
  assert.equal(JSON.stringify(detail).includes("pages/1.png"), false, "the Storage path never reaches the browser");
  const page = normalizeAiDocumentPage({
    pageNo: 2, method: "ocr", width: 1700, height: 2200, textMd: "## Малайзия\n| Программа | Цена |",
    imagePath: `${ORG}/${ID(1)}/pages/2.png`,
    lines: [{ text: "Компьютерные науки 1 250,00 $", box: [0.1, 0.2, 0.9, 0.23] }, { text: "битая", box: [2, 2, 3, 3] }],
    chunks: [{ id: 501, position: 4, sectionPath: "Прайс › Малайзия", content: "Компьютерные науки — 1 250,00 $", boxes: [[0.1, 0.2, 0.9, 0.23]], unverified: true }],
    reviewItems: [{ id: ID(30), status: "open", proposed: "1 250,00 $", bbox: [0.6, 0.2, 0.75, 0.23] }],
  });
  assert.equal(page.hasImage, true);
  assert.equal(page.lines.length, 1);
  assert.equal(page.chunks[0].unverified, true);
  assert.equal(page.reviewItems[0].value, "1 250,00 $");
  assert.equal(JSON.stringify(page).includes(".png"), false);
  // Форма 271: страница вложена в `page`, у фрагмента `chunkId`; «не проверено» — по рамке открытого пункта.
  const nested = normalizeAiDocumentPage({
    documentId: ID(1), docVersion: 2, pageNo: 2, pageCount: 3,
    page: { sheetName: null, method: "ocr", width: 1000, height: 1300, textMd: "x", lines: null, imagePath: `${ORG}/${ID(1)}/pages/2.png` },
    chunks: [{ chunkId: 601, position: 0, sectionPath: "Прайс", boxes: [[0.1, 0.2, 0.9, 0.3]] }, { chunkId: 602, position: 1, sectionPath: "Условия", boxes: [[0.1, 0.6, 0.9, 0.7]] }],
    reviewItems: [{ id: ID(31), status: "open", proposed: "1 250,00 $", bbox: [0.6, 0.22, 0.7, 0.25], cropPath: "x" }],
  });
  assert.equal(nested.hasImage, true);
  assert.equal(nested.width, 1000);
  assert.deepEqual(nested.chunks.map((chunk) => [chunk.id, chunk.unverified, chunk.content]), [[601, true, ""], [602, false, ""]]);
  assert.equal(JSON.stringify(nested).includes("pages/2.png"), false);
  const review = normalizeAiReviewList({ canManage: true, hasMore: false, counts: { open: 7, applying: 1 }, items: [{
    id: ID(30), documentId: ID(1), documentTitle: "Прайс 2026", pageNo: 2, kind: "number", status: "open", createdAt: "2026-10-06T08:00:00Z",
    candidates: { tesseract: "1 260,00 $", vision: { text: "1 250,00 $" }, arbiter: "1 250,00 $", arbiterModel: "gemini-3.1-pro-preview" },
    proposed: "1 250,00 $", contextLabel: "строка «Компьютерные науки»", cropPath: `${ORG}/${ID(1)}/crops/${ID(30)}.png`,
    hasCrop: true, docVersion: 2,
  }] });
  assert.equal(review.items[0].documentVersion, 2);
  assert.deepEqual(review.items[0].readings, { tesseract: "1 260,00 $", vision: "1 250,00 $", arbiter: "1 250,00 $", arbiterModel: "gemini-3.1-pro-preview" });
  assert.equal(review.items[0].hasCrop, true);
  assert.equal(review.pendingCount, 8, "the «Открытые» tab counts what its list shows: open and applying");
  assert.equal(normalizeAiReviewList({ canManage: true, hasMore: false, items: [] , counts: { open: 2 } }).pendingCount, 2);
  assert.equal(JSON.stringify(review).includes("crops/"), false);
  assert.throws(() => normalizeAiReviewList({ items: [{ id: "x" }], canManage: true }), /ai_agent_shape_invalid/u);
  const lab = normalizeAiLabState({ canManage: true,
    session: { revision: 3, payload: { question: "Сколько стоит?", finding: "Цена устарела", answer: { reply: "От 1 250 $.", sources: [], citations: [], reply_citations: [] } } },
    // Форма 273: цель плоско, `sources` — id документов.
    proposal: { id: ID(40), kind: "document", status: "proposed", createdAt: "2026-10-06T08:00:00Z", before: "1 250,00 $", after: "1 300,00 $",
      answer: "Обучение стоит от 1 300 $ в год.", question: "Сколько стоит?", finding: "Цена устарела", why: "В прайсе новая цена.",
      documentId: ID(1), documentTitle: "Прайс 2026", docVersion: 2, rulesVersionId: null, title: null, audience: "client",
      sources: [ID(1)], proposalSha256: "a".repeat(64), expiresAt: "2026-10-06T10:00:00Z" } });
  assert.equal(lab.session.revision, 3);
  assert.equal(lab.session.answer.reply, "От 1 250 $.");
  assert.equal(lab.proposal.target.title, "Прайс 2026");
  assert.throws(() => normalizeAiLabState({ canManage: true, proposal: { id: ID(40), kind: "delete_everything", status: "proposed", after: "", createdAt: "x" } }), /ai_agent_shape_invalid/u);
  const examples = normalizeAiExamples({ canManage: true, items: [
    { id: ID(50), question: "Сколько стоит?", answer: "От 1 300 $.", confirmedAt: "2026-10-06T08:00:00Z", valid: true },
    { id: ID(51), question: "Виза?", answer: "Две недели.", confirmedAt: "2026-10-06T08:00:00Z", valid: false,
      stale: { legacy: false, rules: false, model: false, documents: [ID(1)] } },
    { id: ID(52), question: "Скидки?", answer: "Нет.", confirmedAt: "2026-10-06T08:00:00Z", valid: false,
      stale: { legacy: false, rules: true, model: false, documents: [] } },
  ] });
  assert.deepEqual(examples.items.map((item) => [item.valid, item.staleReason]), [[true, null], [false, "document"], [false, "rules"]]);
});

test("lab stream: answer frames reuse the chat contract; critique ends in a proposal or no_change", () => {
  assert.deepEqual(parseAiLabStreamEvent("status", JSON.stringify({ stage: "searching" })), { type: "status", stage: "searching" });
  assert.deepEqual(parseAiLabStreamEvent("status", JSON.stringify({ stage: "reviewing" })), { type: "reviewing" });
  assert.deepEqual(parseAiLabStreamEvent("final", JSON.stringify({ proposal: { id: ID(40) } })), { type: "proposal", proposalId: ID(40) });
  assert.deepEqual(parseAiLabStreamEvent("no_change", JSON.stringify({ why: "В материалах всё верно." })), { type: "no_change", why: "В материалах всё верно." });
  assert.deepEqual(parseAiLabStreamEvent("final", JSON.stringify({ answer: {} })), { type: "final", answerId: null });
  assert.equal(parseAiLabStreamEvent("delta", "{bad"), null);
});

// ------------------------------------------------------------ upload route

function knowledgeDeps(overrides = {}) {
  const calls = { rpc: [], stored: [], removed: [], scanned: 0, authorized: [] };
  const objects = new Map(overrides.objects ?? []);
  const rpcResult = overrides.rpc ?? (async (name, args) => (name === "ai_agent_document_upload_v1"
    ? { data: { status: "queued", document: {
      id: args.p_document_id, title: args.p_title, kind: args.p_kind, audience: args.p_audience ?? "client", status: "queued",
      source: "upload", sourceRef: {}, rowVersion: 1, docVersion: 1, updatedAt: "2026-10-06T08:00:00Z" } }, error: null }
    : { data: null, error: { code: "XX000", message: "unexpected" } }));
  const deps = {
    authorize: overrides.authorize ?? (async (access) => { calls.authorized.push(access); return { status: "authorized", actor: ACTOR }; }),
    rpc: async (name, args) => { calls.rpc.push([name, args]); return rpcResult(name, args); },
    storage: () => ({
      async putOriginal(path, bytes, contentType) {
        calls.stored.push([path, contentType, bytes.byteLength]);
        if (overrides.put) return overrides.put(path);
        if (objects.has(path)) return "exists";
        objects.set(path, { bytes, contentType });
        return "stored";
      },
      async get(path) { return objects.get(path) ?? "missing"; },
      async remove(paths) { calls.removed.push(...paths); for (const path of paths) objects.delete(path); return true; },
    }),
    scan: overrides.scan ?? (async (bytes) => { calls.scanned += 1; return proof(bytes); }),
    config: overrides.config ?? (() => null),
    fetch: overrides.fetch ?? ((...args) => fetch(...args)),
    now: () => Date.now(),
  };
  return { deps, calls, objects };
}

function uploadRequest(fields, { headers = {} } = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return new Request("https://crm.test/api/v3/ai-agent/documents", { method: "POST", headers: { ...origin, ...headers }, body: form });
}
const fileOf = (bytes, name, type) => new File([bytes], name, { type });
const newUpload = (file, extra = {}) => ({
  file, title: "Прайс 2026", company_material: "true", request_id: ID(7), audience: "client", client_confirmed: "true", ...extra,
});

test("upload: scanned, stored under {org}/{doc}/original without overwrite, then one RPC with the scan proof", async () => {
  const { deps, calls } = knowledgeDeps();
  const bytes = ooxml("xlsx");
  const response = await createAiDocumentUploadHandler(deps)(uploadRequest(newUpload(fileOf(bytes, "Прайс 2026.xlsx", XLSX))));
  assert.equal(response.status, 201);
  const documentId = aiDocumentIdForRequest(ORG, ID(7), sha(bytes));
  const body = await response.json();
  assert.equal(body.documentId, documentId);
  assert.equal(body.document.status, "queued");
  assert.deepEqual(calls.authorized, ["write"]);
  assert.equal(calls.scanned, 1);
  assert.deepEqual(calls.stored, [[`${ORG}/${documentId}/original`, XLSX, bytes.byteLength]]);
  const [[name, args]] = calls.rpc;
  assert.equal(name, "ai_agent_document_upload_v1");
  assert.deepEqual({ ...args, p_scan_proof: undefined }, {
    p_organization_id: ORG, p_document_id: documentId, p_title: "Прайс 2026", p_kind: "xlsx", p_mime_type: XLSX,
    p_byte_size: bytes.byteLength, p_byte_sha256: sha(bytes), p_audience: "client", p_client_confirmed: true,
    p_company_material: true, p_replaces_id: null, p_replaces_version: null, p_scan_proof: undefined, p_request_id: ID(7),
  });
  // 271 принимает доказательство ClamAV ровно с этими ключами.
  assert.deepEqual(Object.keys(args.p_scan_proof).sort(), ["engine", "engineVersion", "protocol", "scannedAt", "sha256Hex", "signatureVersion"]);
  assert.equal(args.p_scan_proof.sha256Hex, sha(bytes));
  assert.match(args.p_scan_proof.scannedAt, /Z$/u);
});

test("upload: a new version sends the predecessor and its row version, never an audience", async () => {
  const { deps, calls } = knowledgeDeps();
  const response = await createAiDocumentUploadHandler(deps)(uploadRequest({
    file: fileOf(pdf(), "буклет.pdf", "application/pdf"), title: "Буклет", company_material: "true", request_id: ID(8),
    replaces_id: ID(1), replaces_version: "4",
  }));
  assert.equal(response.status, 201);
  const args = calls.rpc[0][1];
  assert.equal(args.p_replaces_id, ID(1));
  assert.equal(args.p_replaces_version, 4);
  assert.equal(args.p_audience, null);
  assert.equal(args.p_client_confirmed, false);
  const mixed = await createAiDocumentUploadHandler(deps)(uploadRequest({
    file: fileOf(pdf(), "буклет.pdf", "application/pdf"), title: "Буклет", company_material: "true", request_id: ID(8),
    replaces_id: ID(1), replaces_version: "4", audience: "internal",
  }));
  assert.equal(mixed.status, 400, "a replacement cannot choose its audience");
});

test("upload: refusals before Storage — origin, session, preview, fields, type, signature, macro, size", async () => {
  const pdfFile = () => fileOf(pdf(), "прайс.pdf", "application/pdf");
  const cases = [
    [knowledgeDeps(), uploadRequest(newUpload(pdfFile()), { headers: { origin: "https://evil.test" } }), 403, "forbidden"],
    [knowledgeDeps({ authorize: async () => ({ status: "anonymous", actor: null }) }), uploadRequest(newUpload(pdfFile())), 401, "authentication_required"],
    [knowledgeDeps({ authorize: async () => ({ status: "preview", actor: null }) }), uploadRequest(newUpload(pdfFile())), 403, "preview"],
    [knowledgeDeps(), uploadRequest(newUpload(pdfFile(), { company_material: "false" })), 400, "company_material_required"],
    [knowledgeDeps(), uploadRequest(newUpload(pdfFile(), { client_confirmed: "false" })), 400, "client_confirmation_required"],
    [knowledgeDeps(), uploadRequest(newUpload(pdfFile(), { title: " " })), 400, "invalid_title"],
    [knowledgeDeps(), uploadRequest(newUpload(pdfFile(), { request_id: "not-a-uuid" })), 400, "invalid_request"],
    [knowledgeDeps(), uploadRequest({ ...newUpload(pdfFile()), extra: "1" }), 400, "invalid_request"],
    [knowledgeDeps(), uploadRequest(newUpload(fileOf(pdf(), "прайс.docx", DOCX))), 415, "content_mismatch"],
    [knowledgeDeps(), uploadRequest(newUpload(fileOf(pdf(), "прайс.pdf", "image/png"))), 415, "type_mismatch"],
    [knowledgeDeps(), uploadRequest(newUpload(fileOf(ooxml("docx", { files: { "word/vbaProject.bin": "x" } }), "политика.docx", DOCX))), 415, "macro"],
    [knowledgeDeps(), uploadRequest(newUpload(fileOf(pdf(), "макрос.docm", ""))), 415, "macro"],
    [knowledgeDeps(), uploadRequest(newUpload(fileOf(new Uint8Array([0x41, 0x00]), "a.txt", "text/plain"))), 415, "text_encoding"],
  ];
  for (const [{ deps, calls }, request, status, code] of cases) {
    const response = await createAiDocumentUploadHandler(deps)(request);
    assert.equal(response.status, status, code);
    assert.equal((await response.json()).error.code, code);
    assert.equal(calls.stored.length, 0, `${code}: nothing stored`);
    assert.equal(calls.rpc.length, 0, `${code}: no RPC`);
  }
  const { deps } = knowledgeDeps();
  const json = new Request("https://crm.test/api/v3/ai-agent/documents", { method: "POST", headers: { ...origin, "content-type": "application/json" }, body: "{}" });
  assert.equal((await createAiDocumentUploadHandler(deps)(json)).status, 415);
});

test("upload: the body is counted as it streams — no Content-Length, 26 MB → 413 before parsing", async () => {
  const { deps, calls } = knowledgeDeps();
  let sent = 0;
  const chunk = new Uint8Array(1024 * 1024);
  const stream = new ReadableStream({
    pull(controller) {
      if (sent >= 30) { controller.close(); return; }
      sent += 1;
      controller.enqueue(chunk);
    },
  });
  const request = new Request("https://crm.test/api/v3/ai-agent/documents", {
    method: "POST", headers: { ...origin, "content-type": "multipart/form-data; boundary=synthetic" }, body: stream, duplex: "half",
  });
  const response = await createAiDocumentUploadHandler(deps)(request);
  assert.equal(response.status, 413);
  assert.ok(sent <= 27, `stopped reading at ${sent} MB`);
  assert.equal(calls.scanned + calls.stored.length + calls.rpc.length, 0);
  const declared = new Request("https://crm.test/api/v3/ai-agent/documents", {
    method: "POST", headers: { ...origin, "content-type": "multipart/form-data; boundary=x", "content-length": String(40 * 1024 * 1024) }, body: "x",
  });
  assert.equal((await createAiDocumentUploadHandler(deps)(declared)).status, 413);
});

test("upload: infected → 422 and nothing stored; scanner down → 503 and nothing stored", async () => {
  const infected = knowledgeDeps({ scan: async () => { throw new ClamdScanError("infected"); } });
  const response = await createAiDocumentUploadHandler(infected.deps)(uploadRequest(newUpload(fileOf(pdf(), "прайс.pdf", "application/pdf"))));
  assert.equal(response.status, 422);
  assert.equal((await response.json()).error.code, "malware_detected");
  assert.equal(aiUploadErrorCopy("malware_detected"), "Файл не прошёл проверку на вирусы.");
  assert.equal(infected.calls.stored.length + infected.calls.rpc.length, 0);
  for (const scan of [async () => { throw new ClamdScanError("unavailable"); }, async () => { throw new Error("socket"); },
    async () => ({ ...proof(pdf()), sha256Hex: "0".repeat(64) })]) {
    const down = knowledgeDeps({ scan });
    const failed = await createAiDocumentUploadHandler(down.deps)(uploadRequest(newUpload(fileOf(pdf(), "прайс.pdf", "application/pdf"))));
    assert.equal(failed.status, 503);
    assert.equal((await failed.json()).error.code, "malware_scanner_unavailable");
    assert.equal(down.calls.stored.length + down.calls.rpc.length, 0);
  }
});

test("upload: a final database refusal removes the new object; an unknown outcome or a replayed object stays", async () => {
  const refusals = [
    [{ code: "PT409", message: "ai_document_duplicate", details: "Прайс 2025" }, 409, "duplicate", "Прайс 2025"],
    [{ code: "PT409", message: "ai_document_replacement_pending" }, 409, "replacement_pending"],
    [{ code: "42501", message: "ai_staff_forbidden" }, 403, "forbidden"],
    [{ code: "P0002", message: "ai_document_not_found" }, 404, "not_found"],
    [{ code: "22023", message: "ai_document_kind_mismatch" }, 400, "invalid_request"],
  ];
  for (const [error, status, code, title] of refusals) {
    const { deps, calls, objects } = knowledgeDeps({ rpc: async () => ({ data: null, error }) });
    const response = await createAiDocumentUploadHandler(deps)(uploadRequest(newUpload(fileOf(pdf(), "прайс.pdf", "application/pdf"))));
    assert.equal(response.status, status, code);
    const body = await response.json();
    assert.equal(body.error.code, code);
    if (title) assert.equal(body.error.title, title);
    assert.equal(calls.removed.length, 1, `${code}: the object is removed`);
    assert.equal(objects.size, 0);
  }
  const unknown = knowledgeDeps({ rpc: async () => ({ data: null, error: { code: "08006", message: "connection" } }) });
  const response = await createAiDocumentUploadHandler(unknown.deps)(uploadRequest(newUpload(fileOf(pdf(), "прайс.pdf", "application/pdf"))));
  assert.equal(response.status, 503);
  assert.equal(unknown.calls.removed.length, 0, "the database may have committed: the object stays for a replay");
  const storageDown = knowledgeDeps({ put: async () => "failed" });
  const stored = await createAiDocumentUploadHandler(storageDown.deps)(uploadRequest(newUpload(fileOf(pdf(), "прайс.pdf", "application/pdf"))));
  assert.equal(stored.status, 503);
  assert.equal(storageDown.calls.rpc.length, 0);
});

test("upload: a request already recorded with other input (23505, as 269 raises it) is a final 409 already_uploaded, never a retry loop", async () => {
  const conflict = { code: "23505", message: "ai_request_conflict" };
  // Первая попытка записана, ответ потерялся, название с тех пор изменено:
  // те же байты — тот же объект, он оригинал записанного документа.
  const bytes = pdf();
  const path = `${ORG}/${aiDocumentIdForRequest(ORG, ID(7), sha(bytes))}/original`;
  const replay = knowledgeDeps({ objects: [[path, { bytes, contentType: "application/pdf" }]], rpc: async () => ({ data: null, error: conflict }) });
  const replayed = await createAiDocumentUploadHandler(replay.deps)(uploadRequest(newUpload(fileOf(bytes, "прайс.pdf", "application/pdf"), { title: "Прайс 2026 (правка)" })));
  assert.equal(replayed.status, 409);
  assert.equal((await replayed.json()).error.code, "already_uploaded");
  assert.equal(aiUploadRetryable("already_uploaded"), false, "the client takes a new request id instead of replaying a conflict forever");
  assert.match(aiUploadErrorCopy("already_uploaded"), /уже загрузила/u);
  assert.deepEqual(replay.calls.stored.map(([stored]) => stored), [path]);
  assert.equal(replay.calls.removed.length, 0, "the recorded document keeps its original");
  assert.equal(replay.calls.rpc.length, 1, "no lookup: 23505 means the request was recorded");
  // Тот же id запроса с другими байтами — другой объект; свой новый объект удаляется.
  const other = knowledgeDeps({ objects: [[path, { bytes, contentType: "application/pdf" }]], rpc: async () => ({ data: null, error: conflict }) });
  const edited = new TextEncoder().encode("%PDF-1.7\n% другой файл\n%%EOF\n");
  const response = await createAiDocumentUploadHandler(other.deps)(uploadRequest(newUpload(fileOf(edited, "прайс.pdf", "application/pdf"))));
  assert.equal(response.status, 409);
  const otherPath = `${ORG}/${aiDocumentIdForRequest(ORG, ID(7), sha(edited))}/original`;
  assert.notEqual(otherPath, path);
  assert.deepEqual(other.calls.stored.map(([stored]) => stored), [otherPath], "B never lands on A's object");
  assert.deepEqual(other.calls.removed, [otherPath]);
  assert.deepEqual(other.objects.get(path)?.bytes, bytes, "A stays untouched");
  // ai_document_id_taken — тоже 23505.
  const taken = knowledgeDeps({ rpc: async () => ({ data: null, error: { code: "23505", message: "ai_document_id_taken" } }) });
  const takenResponse = await createAiDocumentUploadHandler(taken.deps)(uploadRequest(newUpload(fileOf(pdf(), "прайс.pdf", "application/pdf"))));
  assert.equal(takenResponse.status, 409);
  assert.equal((await takenResponse.json()).error.code, "already_uploaded");
});

test("upload: a final refusal on an object left by an earlier attempt removes it only when no document has its id", async () => {
  const bytes = pdf();
  const documentId = aiDocumentIdForRequest(ORG, ID(7), sha(bytes));
  const path = `${ORG}/${documentId}/original`;
  const duplicate = { code: "PT409", message: "ai_document_duplicate", details: "Прайс 2025" };
  for (const [lookup, removed] of [
    [{ code: "P0002", message: "ai_document_not_found" }, [path]],
    [null, []],
    [{ code: "42501", message: "ai_staff_forbidden" }, []],
    [{ code: "08006", message: "connection" }, []],
  ]) {
    const { deps, calls } = knowledgeDeps({
      objects: [[path, { bytes, contentType: "application/pdf" }]],
      rpc: async (name, args) => name === "ai_agent_document_upload_v1" ? { data: null, error: duplicate }
        : name === "ai_agent_document_v1" && args.p_document_id === documentId && args.p_organization_id === ORG
          ? { data: lookup ? null : { document: { id: documentId } }, error: lookup }
          : { data: null, error: { code: "XX000", message: "unexpected" } },
    });
    const response = await createAiDocumentUploadHandler(deps)(uploadRequest(newUpload(fileOf(bytes, "прайс.pdf", "application/pdf"))));
    assert.equal(response.status, 409);
    assert.deepEqual(calls.removed, removed, `lookup ${lookup?.code ?? "found"}`);
    assert.deepEqual(calls.rpc.map(([name]) => name), ["ai_agent_document_upload_v1", "ai_agent_document_v1"]);
  }
});

test("upload: one CRM instance takes at most three uploads at a time; the fourth is 503 upload_busy before its body is read", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const { deps, calls } = knowledgeDeps({ scan: async (bytes) => { calls.scanned += 1; await gate; return proof(bytes); } });
  const handler = createAiDocumentUploadHandler(deps);
  const request = (n) => uploadRequest(newUpload(fileOf(pdf(), "прайс.pdf", "application/pdf"), { request_id: ID(100 + n) }));
  const running = [handler(request(1)), handler(request(2)), handler(request(3))];
  while (calls.scanned < 3) await new Promise((resolve) => setTimeout(resolve, 5));
  const busy = await handler(request(4));
  assert.equal(busy.status, 503);
  assert.equal((await busy.json()).error.code, "upload_busy");
  assert.equal(aiUploadRetryable("upload_busy"), true, "nothing was stored: the same request may be retried");
  assert.equal(calls.scanned, 3);
  release();
  assert.deepEqual((await Promise.all(running)).map((response) => response.status), [201, 201, 201]);
  assert.equal((await handler(request(5))).status, 201, "the slots are released");
});

// ------------------------------------------------------------ images

const detailData = (pages) => ({
  document: { id: ID(1), title: "Скан прайса", kind: "pdf", audience: "client", status: "review", source: "upload", sourceRef: {},
    rowVersion: 2, updatedAt: "2026-10-06T08:00:00Z" },
  pages, canManage: true,
});

test("images: page image and crop stream from {org}/{doc}/… after ai_agent_document_v1; nothing else is reachable", async () => {
  const pagePng = await png(20, 30);
  const objects = [[`${ORG}/${ID(1)}/pages/2.png`, { bytes: pagePng, contentType: "image/png" }],
    [`${ORG}/${ID(1)}/crops/${ID(30)}.png`, { bytes: pagePng, contentType: "image/png" }],
    [`${ORG}/${ID(1)}/pages/3.png`, { bytes: pdf(), contentType: "application/pdf" }]];
  const rpc = async (name, args) => (name === "ai_agent_document_v1" && args.p_document_id === ID(1)
    ? { data: detailData([{ pageNo: 1, hasImage: false }, { pageNo: 2, hasImage: true }, { pageNo: 3, hasImage: true }]), error: null }
    : { data: null, error: { code: "P0002", message: "ai_document_not_found" } });
  const { deps, calls } = knowledgeDeps({ objects, rpc });
  const page = (documentId, n) => ({ params: Promise.resolve({ documentId, page: String(n) }) });
  const get = new Request("https://crm.test/x");
  const ok = await createAiDocumentPageImageHandler(deps)(get, page(ID(1), 2));
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("content-type"), "image/png");
  assert.equal(ok.headers.get("cache-control"), "private, no-store");
  assert.equal(ok.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(new Uint8Array(await ok.arrayBuffer()), pagePng);
  assert.deepEqual(calls.authorized, ["read"], "reading works in role preview too");
  assert.equal((await createAiDocumentPageImageHandler(deps)(get, page(ID(1), 1))).status, 404, "a page without an image");
  assert.equal((await createAiDocumentPageImageHandler(deps)(get, page(ID(1), 3))).status, 404, "a non-PNG object is never served");
  assert.equal((await createAiDocumentPageImageHandler(deps)(get, page(ID(2), 2))).status, 404, "another document");
  assert.equal((await createAiDocumentPageImageHandler(deps)(get, page(ID(1), "0"))).status, 404);
  assert.equal((await createAiDocumentPageImageHandler(deps)(get, page("../x", 1))).status, 404);
  const crop = await createAiReviewCropHandler(deps)(get, { params: Promise.resolve({ documentId: ID(1), itemId: ID(30) }) });
  assert.equal(crop.status, 200);
  assert.equal((await createAiReviewCropHandler(deps)(get, { params: Promise.resolve({ documentId: ID(1), itemId: ID(31) }) })).status, 404);
  const forbidden = knowledgeDeps({ rpc: async () => ({ data: null, error: { code: "42501", message: "x" } }) });
  assert.equal((await createAiDocumentPageImageHandler(forbidden.deps)(get, page(ID(1), 2))).status, 403);
  const anonymous = knowledgeDeps({ authorize: async () => ({ status: "anonymous", actor: null }) });
  assert.equal((await createAiReviewCropHandler(anonymous.deps)(get, { params: Promise.resolve({ documentId: ID(1), itemId: ID(30) }) })).status, 401);
});

// ------------------------------------------------------------ laboratory

function agentVerifies(request, body) {
  const ts = request.headers["x-evo-ai-timestamp"];
  const signature = request.headers["x-evo-ai-signature"];
  if (typeof ts !== "string" || typeof signature !== "string") return false;
  const digest = createHash("sha256").update(body).digest("hex");
  return createHmac("sha256", SECRET).update(`${ts}.${request.method}.${request.url}.${digest}`).digest("hex") === signature;
}

async function fakeAgent(behaviour) {
  const seen = [];
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const body = Buffer.concat(chunks);
      const entry = { method: request.method, url: request.url, verified: agentVerifies(request, body), body: body.toString("utf8") };
      seen.push(entry);
      behaviour(entry, response);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    seen,
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(resolve); }),
  };
}
const frame = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const post = (path, body, headers = {}) => new Request(`https://crm.test${path}`, {
  method: "POST", headers: { "content-type": "application/json", ...origin, ...headers }, body: JSON.stringify(body),
});
const ticketRpc = (calls) => async (name, args) => {
  calls.push([name, args]);
  if (name === "ai_agent_ticket_v1") return { data: { ticket: TICKET }, error: null };
  return { data: null, error: { code: "XX000" } };
};

test("lab ask/critique: a laboratory ticket without a conversation, a signed request and the agent's SSE piped through", async () => {
  const agent = await fakeAgent((entry, response) => {
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    if (entry.url === "/v1/lab/ask") {
      response.write(frame("status", { stage: "searching" }));
      response.end(frame("final", { answer: { reply: "От 1 250 $." } }));
    } else {
      response.write(frame("status", { stage: "reviewing" }));
      response.end(frame("final", { proposal: { id: ID(40) } }));
    }
  });
  try {
    const rpcCalls = [];
    const { deps, calls } = knowledgeDeps({ rpc: ticketRpc(rpcCalls), config: () => ({ secret: SECRET, baseUrl: agent.baseUrl }) });
    const asked = await createAiLabAskHandler(deps)(post("/api/v3/ai-agent/lab/ask", { question: "  Сколько стоит бакалавриат?  " }));
    assert.equal(asked.status, 200);
    assert.equal(asked.headers.get("content-type"), "text/event-stream; charset=utf-8");
    assert.match(await asked.text(), /event: status[\s\S]*event: final/u);
    const critiqued = await createAiLabCritiqueHandler(deps)(post("/api/v3/ai-agent/lab/critique", { finding: "Цена устарела" }));
    assert.match(await critiqued.text(), /"proposal"/u);
    assert.deepEqual(calls.authorized, ["agent", "agent"]);
    assert.deepEqual(rpcCalls.map(([name, args]) => [name, args.p_purpose, args.p_conversation_id, args.p_ref_id]),
      [["ai_agent_ticket_v1", "laboratory", null, null], ["ai_agent_ticket_v1", "laboratory", null, null]]);
    assert.deepEqual(agent.seen.map((entry) => [entry.url, entry.verified, JSON.parse(entry.body)]), [
      ["/v1/lab/ask", true, { ticket: TICKET, question: "Сколько стоит бакалавриат?" }],
      ["/v1/lab/critique", true, { ticket: TICKET, finding: "Цена устарела" }],
    ]);
  } finally {
    await agent.close();
  }
});

test("lab apply: a lab_apply ticket for the caller's proposal; 409 lab_changed and 422 lab_edit_invalid reach the window", async () => {
  const replies = [
    [200, { status: "applied", kind: "document", documentId: ID(1) }],
    [409, { error: { code: "lab_changed", message_ru: "x", status: 409 } }],
    [422, { error: { code: "lab_edit_invalid", status: 422 } }],
    [500, { error: { code: "internal_detail_never_shown" } }],
  ];
  const agent = await fakeAgent((entry, response) => {
    const [status, body] = replies.shift();
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(JSON.stringify(body));
  });
  try {
    const rpcCalls = [];
    const { deps, calls } = knowledgeDeps({ rpc: ticketRpc(rpcCalls), config: () => ({ secret: SECRET, baseUrl: agent.baseUrl }) });
    const handler = createAiLabApplyHandler(deps);
    const applied = await handler(post("/api/v3/ai-agent/lab/apply", { proposalId: ID(40) }));
    assert.equal(applied.status, 200);
    assert.deepEqual(await applied.json(), { status: "applied", kind: "document", documentId: ID(1) });
    const changed = await handler(post("/api/v3/ai-agent/lab/apply", { proposalId: ID(40) }));
    assert.equal(changed.status, 409);
    assert.equal((await changed.json()).error.code, "lab_changed");
    const invalid = await handler(post("/api/v3/ai-agent/lab/apply", { proposalId: ID(40) }));
    assert.equal(invalid.status, 422);
    assert.equal((await invalid.json()).error.code, "lab_edit_invalid");
    const broken = await handler(post("/api/v3/ai-agent/lab/apply", { proposalId: ID(40) }));
    assert.equal(broken.status, 503);
    assert.equal((await broken.json()).error.code, "agent_unavailable");
    assert.deepEqual(calls.authorized, ["write", "write", "write", "write"]);
    assert.deepEqual(rpcCalls[0][1], { p_organization_id: ORG, p_purpose: "lab_apply", p_conversation_id: null, p_ref_id: ID(40) });
    assert.deepEqual(JSON.parse(agent.seen[0].body), { ticket: TICKET });
    assert.equal(agent.seen[0].url, "/v1/lab/apply");
    assert.equal(agent.seen[0].verified, true);
  } finally {
    await agent.close();
  }
});

test("lab: refusals before the agent — off, preview, bad body, foreign origin, ticket refused", async () => {
  const off = knowledgeDeps();
  assert.equal((await (await createAiLabAskHandler(off.deps)(post("/api/v3/ai-agent/lab/ask", { question: "Цена?" }))).json()).error.code, "ai_agent_off");
  const preview = knowledgeDeps({ authorize: async () => ({ status: "preview", actor: null }) });
  assert.equal((await createAiLabAskHandler(preview.deps)(post("/api/v3/ai-agent/lab/ask", { question: "Цена?" }))).status, 403);
  const { deps } = knowledgeDeps({ config: () => ({ secret: SECRET, baseUrl: "http://127.0.0.1:9" }) });
  for (const body of [{}, { question: "" }, { question: "x".repeat(2001) }, { question: "Цена?", extra: 1 }, { finding: "x" }]) {
    assert.equal((await createAiLabAskHandler(deps)(post("/api/v3/ai-agent/lab/ask", body))).status, 400, JSON.stringify(body));
  }
  assert.equal((await createAiLabAskHandler(deps)(post("/api/v3/ai-agent/lab/ask", { question: "Цена?" }, { origin: "https://evil.test" }))).status, 403);
  assert.equal((await createAiLabApplyHandler(deps)(post("/api/v3/ai-agent/lab/apply", { proposalId: "x" }))).status, 400);
  for (const [error, status, code] of [[{ code: "PT412" }, 412, "consent_required"], [{ code: "PT429" }, 429, "rate_limited"],
    [{ code: "42501" }, 403, "forbidden"], [{ code: "PT409" }, 409, "lab_changed"]]) {
    const refused = knowledgeDeps({ config: () => ({ secret: SECRET, baseUrl: "http://127.0.0.1:9" }), rpc: async () => ({ data: null, error }) });
    const response = await createAiLabApplyHandler(refused.deps)(post("/api/v3/ai-agent/lab/apply", { proposalId: ID(40) }));
    assert.equal(response.status, status);
    assert.equal((await response.json()).error.code, code);
  }
  const state = knowledgeDeps({ rpc: async () => ({ data: { canManage: true, session: null, proposal: null }, error: null }) });
  const read = await createAiLabStateHandler(state.deps)(new Request("https://crm.test/api/v3/ai-agent/lab"));
  assert.deepEqual(await read.json(), { state: { session: null, proposal: null, canManage: true }, featureOn: false });
  assert.equal((await createAiLabStateHandler(state.deps)(new Request("https://crm.test/api/v3/ai-agent/lab?x=1"))).status, 400);
});

// ------------------------------------------------------------ storage broker

function brokerDeps(overrides = {}) {
  const calls = { authorized: [], put: [], got: [] };
  const objects = new Map(overrides.objects ?? []);
  return {
    calls,
    deps: {
      secret: overrides.secret ?? (() => STORAGE_SECRET),
      authorize: async (target, worker, method) => { calls.authorized.push([target.objectPath, worker, method]); return overrides.decision ?? "allowed"; },
      get: async (path) => { calls.got.push(path); return objects.get(path) ?? "missing"; },
      put: async (path, bytes, type) => { calls.put.push([path, type, bytes.byteLength]); return true; },
      now: () => Date.now(),
    },
  };
}
const brokerPath = (object, doc = ID(1)) => `/api/internal/ai-agent/storage/${ORG}/${doc}/${object}`;
function signed(method, path, body = new Uint8Array(0), { ts = Math.floor(Date.now() / 1000), secret = STORAGE_SECRET, worker = "worker-1", headers = {} } = {}) {
  return new Request(`http://evo-crm-app:3000${path}`, {
    method,
    headers: {
      "X-EVO-AI-Timestamp": String(ts),
      "X-EVO-AI-Signature": signAiStorageRequest(secret, String(ts), method, path, worker, body),
      "X-EVO-AI-Worker": worker,
      ...(method === "PUT" ? { "content-type": "image/png" } : {}),
      ...headers,
    },
    body: method === "GET" || method === "HEAD" ? undefined : body,
  });
}

test("broker: signed GET of the original and PUT of a page, each through ai_agent_storage_authorize_v1", async () => {
  const original = pdf();
  const { deps, calls } = brokerDeps({ objects: [[`${ORG}/${ID(1)}/original`, { bytes: original, contentType: "application/pdf" }]] });
  const handler = createAiStorageBrokerHandler(deps);
  const got = await handler(signed("GET", brokerPath("original")));
  assert.equal(got.status, 200);
  assert.equal(got.headers.get("content-type"), "application/pdf");
  assert.deepEqual(new Uint8Array(await got.arrayBuffer()), original);
  const page = await png(1700, 2200);
  const put = await handler(signed("PUT", brokerPath("pages/3.png"), page));
  assert.equal(put.status, 204);
  const crop = await handler(signed("PUT", brokerPath(`crops/${ID(30)}.png`), await png(300, 40)));
  assert.equal(crop.status, 204);
  assert.deepEqual(calls.authorized, [
    [`${ORG}/${ID(1)}/original`, "worker-1", "GET"],
    [`${ORG}/${ID(1)}/pages/3.png`, "worker-1", "PUT"],
    [`${ORG}/${ID(1)}/crops/${ID(30)}.png`, "worker-1", "PUT"],
  ]);
  assert.deepEqual(calls.put.map(([path, type]) => [path, type]), [[`${ORG}/${ID(1)}/pages/3.png`, "image/png"], [`${ORG}/${ID(1)}/crops/${ID(30)}.png`, "image/png"]]);
});

test("broker: 401 unsigned, stale, wrong secret or tampered body; 403 without the lease; 405 for other methods and objects", async () => {
  const { deps, calls } = brokerDeps();
  const handler = createAiStorageBrokerHandler(deps);
  const pagePng = await png();
  const unsigned = new Request(`http://evo-crm-app:3000${brokerPath("original")}`);
  assert.equal((await handler(unsigned)).status, 401);
  assert.equal((await handler(signed("GET", brokerPath("original"), undefined, { ts: Math.floor(Date.now() / 1000) - 120 }))).status, 401);
  assert.equal((await handler(signed("GET", brokerPath("original"), undefined, { secret: SECRET }))).status, 401, "the agent-call secret is not the broker secret");
  assert.equal((await handler(signed("GET", brokerPath("original"), undefined, { worker: "" }))).status, 401);
  assert.equal((await handler(signed("GET", brokerPath("original"), undefined, { worker: "bad worker" }))).status, 401);
  // Ссылка воркера — под подписью: чужой запрос под другим воркером не пройдёт.
  const signedForOne = signed("GET", brokerPath("original"), undefined, { worker: "worker-1" });
  const asAnother = new Headers(signedForOne.headers);
  asAnother.set("X-EVO-AI-Worker", "worker-2");
  assert.equal((await handler(new Request(signedForOne.url, { headers: asAnother }))).status, 401, "the worker ref is signed");
  const tampered = signed("PUT", brokerPath("pages/1.png"), pagePng);
  const swapped = new Request(tampered.url, { method: "PUT", headers: tampered.headers, body: await png(9, 9) });
  assert.equal((await handler(swapped)).status, 401);
  // Подпись другого пути (другой документ) к этому пути не подходит.
  const other = signed("GET", brokerPath("original", ID(2)));
  assert.equal((await handler(new Request(`http://evo-crm-app:3000${brokerPath("original")}`, { headers: other.headers }))).status, 401);
  assert.equal(calls.authorized.length, 0, "nothing reaches the database unsigned");
  for (const [method, object, allow] of [["DELETE", "original", "GET"], ["POST", "pages/1.png", "GET, PUT"], ["PATCH", "pages/1.png", "GET, PUT"],
    ["PUT", "original", "GET"], ["GET", `crops/${ID(30)}.png`, "PUT"]]) {
    const response = await handler(signed(method, brokerPath(object), method === "PUT" ? pagePng : new Uint8Array(0)));
    assert.equal(response.status, 405, `${method} ${object}`);
    assert.equal(response.headers.get("allow"), allow);
  }
  const denied = brokerDeps({ decision: "denied" });
  assert.equal((await createAiStorageBrokerHandler(denied.deps)(signed("GET", brokerPath("original")))).status, 403, "no lease, or another document's lease");
  const missing = brokerDeps();
  assert.equal((await createAiStorageBrokerHandler(missing.deps)(signed("GET", brokerPath("pages/2.png")))).status, 404);
  const off = brokerDeps({ secret: () => null });
  assert.equal((await createAiStorageBrokerHandler(off.deps)(signed("GET", brokerPath("original")))).status, 503);
});

test("broker: the signed string is ts.METHOD.path.workerRef.sha256(body) — the vector shared with the private agent", () => {
  // Синтетический вектор; те же значения проверяет клиент брокера в приватном evo-ai-agent
  // (tests/unit/test_broker.py): смена подписываемой строки на любой стороне ломает оба теста.
  const secret = "v".repeat(24) + "-synthetic-storage-broker-vector";
  const ts = "1790000000";
  const worker = "evo-ai-agent-worker-1:42";
  const base = "/api/internal/ai-agent/storage/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222";
  assert.equal(signAiStorageRequest(secret, ts, "GET", `${base}/original`, worker, new Uint8Array(0)),
    "98d9e06b8ce671d4d3a3204b41fe8f5f62588052203879404544a13c4d9d7096");
  assert.equal(signAiStorageRequest(secret, ts, "PUT", `${base}/crops/33333333-3333-4333-8333-333333333333.png`, worker,
    new TextEncoder().encode("synthetic broker body")), "4c78c6e12491ab098613873d751eeb46945412c2b9e5660dc8b229667f8ea8c3");
});

test("broker: PNG only, ≤ 8 MB and ≤ 4000 px; strict paths — no traversal, no listing, no other bucket", async () => {
  const { deps, calls } = brokerDeps();
  const handler = createAiStorageBrokerHandler(deps);
  assert.equal((await handler(signed("PUT", brokerPath("pages/1.png"), await jpeg(), { headers: { "content-type": "image/png" } }))).status, 415);
  assert.equal((await handler(signed("PUT", brokerPath("pages/1.png"), await png(), { headers: { "content-type": "image/jpeg" } }))).status, 415);
  assert.equal((await handler(signed("PUT", brokerPath("pages/1.png"), await png(4001, 10)))).status, 422);
  assert.equal((await handler(signed("PUT", brokerPath("pages/1.png"), new Uint8Array(8 * 1024 * 1024 + 1)))).status, 413);
  assert.equal(calls.put.length, 0);
  const pathname = (path) => new URL(path, "http://x").pathname;
  for (const path of [
    `/api/internal/ai-agent/storage/${ORG}/${ID(1)}`,
    `/api/internal/ai-agent/storage/${ORG}/${ID(1)}/`,
    `/api/internal/ai-agent/storage/${ORG}/${ID(1)}/pages/`,
    `/api/internal/ai-agent/storage/${ORG}/${ID(1)}/pages/0.png`,
    `/api/internal/ai-agent/storage/${ORG}/${ID(1)}/pages/301.png`,
    `/api/internal/ai-agent/storage/${ORG}/${ID(1)}/pages/1.jpg`,
    `/api/internal/ai-agent/storage/${ORG}/${ID(1)}/crops/x.png`,
    `/api/internal/ai-agent/storage/${ORG}/${ID(1)}/original/extra`,
    `/api/internal/ai-agent/storage/${ORG}/${UPPER_ID}/original`,
    `/api/internal/ai-agent/storage/${ORG}/original`,
    `/api/internal/ai-agent/storage/other-bucket/${ID(1)}/original`,
  ]) {
    assert.equal(parseAiBrokerPath(pathname(path)), null, path);
    const response = await handler(signed("GET", pathname(path)));
    assert.equal(response.status, 404, path);
  }
  // `..` и `%2e%2e` URL сводит к другому пути до обработчика; сырой путь с ними не разбирается.
  for (const raw of [`/api/internal/ai-agent/storage/${ORG}/${ID(1)}/%2e%2e/${ID(2)}/original`,
    `/api/internal/ai-agent/storage/${ORG}/${ID(1)}/../${ID(2)}/original`, `/api/internal/ai-agent/storage/${ORG}/${ID(1)}/pages%2F1.png`]) {
    assert.equal(parseAiBrokerPath(raw), null, raw);
  }
  const query = signed("GET", brokerPath("original"));
  assert.equal((await handler(new Request(`${query.url}?list=1`, { headers: query.headers }))).status, 404, "no query, no listing");
  assert.deepEqual(parseAiBrokerPath(brokerPath(`crops/${ID(30)}.png`)), {
    organizationId: ORG, documentId: ID(1), object: { kind: "crop", itemId: ID(30) }, objectPath: `${ORG}/${ID(1)}/crops/${ID(30)}.png`,
  });
  assert.equal(pngSize(await png(12, 34)).width, 12);
});

test("broker secret: 32–256 printable characters and never the agent-call secret", () => {
  assert.equal(readAiStorageSecret({ EVO_AI_AGENT_STORAGE_SECRET: STORAGE_SECRET }), STORAGE_SECRET);
  assert.equal(readAiStorageSecret({}), null);
  assert.equal(readAiStorageSecret({ EVO_AI_AGENT_STORAGE_SECRET: "short" }), null);
  assert.equal(readAiStorageSecret({ EVO_AI_AGENT_STORAGE_SECRET: SECRET, EVO_AI_AGENT_INTERNAL_SECRET: SECRET }), null);
});

test("delete cleanup: original, pages/* and crops/* of exactly that document", async () => {
  const listed = [];
  const removed = [];
  const tree = new Map([
    [`${ORG}/${ID(1)}`, [{ name: "original", id: "o" }, { name: "pages", id: null }, { name: "crops", id: null }, { name: "other", id: null }]],
    [`${ORG}/${ID(1)}/pages`, [{ name: "1.png", id: "p1" }, { name: "2.png", id: "p2" }]],
    [`${ORG}/${ID(1)}/crops`, [{ name: `${ID(30)}.png`, id: "c1" }]],
  ]);
  const ok = await removeAiDocumentObjects(ORG, ID(1), {
    async list(folder) { listed.push(folder); return tree.get(folder) ?? []; },
    async remove(paths) { removed.push(...paths); return true; },
  });
  assert.equal(ok, true);
  assert.deepEqual(listed, [`${ORG}/${ID(1)}`, `${ORG}/${ID(1)}/pages`, `${ORG}/${ID(1)}/crops`]);
  assert.deepEqual(removed, [`${ORG}/${ID(1)}/original`, `${ORG}/${ID(1)}/pages/1.png`, `${ORG}/${ID(1)}/pages/2.png`, `${ORG}/${ID(1)}/crops/${ID(30)}.png`]);
  assert.equal(await removeAiDocumentObjects(ORG, "../x", { list: async () => [], remove: async () => true }), false);
});

// ------------------------------------------------------------ proxy route contract

const STAFF_P2_APIS = [
  "/api/v3/ai-agent/documents",
  `/api/v3/ai-agent/documents/${ID(1)}/pages/1/image`,
  `/api/v3/ai-agent/documents/${ID(1)}/pages/300/image`,
  `/api/v3/ai-agent/documents/${ID(1)}/crops/${ID(30)}`,
  "/api/v3/ai-agent/lab",
  "/api/v3/ai-agent/lab/ask",
  "/api/v3/ai-agent/lab/critique",
  "/api/v3/ai-agent/lab/apply",
];
const BROKER_PATHS = [brokerPath("original"), brokerPath("pages/1.png"), brokerPath("pages/300.png"), brokerPath(`crops/${ID(30)}.png`)];
const P2_NEAR_MISSES = [
  "/api/v3/ai-agent", "/api/v3/ai-agent/", "/api/v3/ai-agent/documents/", `/api/v3/ai-agent/documents/${ID(1)}`,
  `/api/v3/ai-agent/documents/${ID(1)}/pages/1`, `/api/v3/ai-agent/documents/${ID(1)}/pages/0/image`,
  `/api/v3/ai-agent/documents/${ID(1)}/pages/1/image/`, `/api/v3/ai-agent/documents/${ID(1)}/pages/x/image`,
  `/api/v3/ai-agent/documents/${ID(1)}/crops`, `/api/v3/ai-agent/documents/${ID(1)}/crops/${ID(30)}/x`,
  `/api/v3/ai-agent/documents/not-a-uuid/pages/1/image`, `/api/v3/ai-agent/documents/${ID(1)}/delete`,
  "/api/v3/ai-agent/lab/", "/api/v3/ai-agent/lab/ask/", "/api/v3/ai-agent/lab/discard", "/api/v3/ai-agent/lab/applyx",
  "/api/v3/ai-agent/review", "/api/internal/ai-agent", "/api/internal/ai-agent/storage",
  `/api/internal/ai-agent/storage/${ORG}/${ID(1)}`, `/api/internal/ai-agent/storage/${ORG}/${ID(1)}/`,
  `/api/internal/ai-agent/storage/${ORG}/${ID(1)}/pages/0.png`, `/api/internal/ai-agent/storage/${ORG}/${ID(1)}/pages/1.jpg`,
  `/api/internal/ai-agent/storage/${ORG}/${ID(1)}/original/`, `/api/internal/ai-agent/storage/${ORG}/${UPPER_ID}/original`,
  `/api/internal/ai-agent/storage/${ORG}/${ID(1)}/crops/${ID(30)}`, `/api/internal/ai-agent/storage/${ORG}/${ID(1)}/list`,
];

test("route contract: every P2 route is connected exactly; the broker is a private API; near misses stay closed", () => {
  for (const path of STAFF_P2_APIS) {
    assert.equal(isConnectedPlatformApi(path), true, path);
    assert.equal(isConnectedPlatformPrivateApi(path), false, path);
    assert.equal(isConnectedPlatformPage(path), false, path);
    assert.equal(isRetiredPlatformRoute(path), false, path);
  }
  for (const path of BROKER_PATHS) {
    assert.equal(isConnectedPlatformPrivateApi(path), true, path);
    assert.equal(isConnectedPlatformApi(path), true, path);
    assert.notEqual(parseAiBrokerPath(path), null, `${path}: the handler parses what the proxy connects`);
  }
  for (const path of P2_NEAR_MISSES) {
    assert.equal(isConnectedPlatformApi(path), false, path);
    assert.equal(isConnectedPlatformPrivateApi(path), false, path);
  }
  // Каждый новый route.ts — под шаблоном контракта (урок 06.10: неподключённый маршрут отвечал 403).
  for (const file of [
    "src/app/api/v3/ai-agent/documents/route.ts",
    "src/app/api/v3/ai-agent/documents/[documentId]/pages/[page]/image/route.ts",
    "src/app/api/v3/ai-agent/documents/[documentId]/crops/[itemId]/route.ts",
    "src/app/api/v3/ai-agent/lab/route.ts",
    "src/app/api/v3/ai-agent/lab/ask/route.ts",
    "src/app/api/v3/ai-agent/lab/critique/route.ts",
    "src/app/api/v3/ai-agent/lab/apply/route.ts",
    "src/app/api/internal/ai-agent/storage/[...object]/route.ts",
  ]) {
    const source = read(file);
    assert.match(source, /export const runtime = "nodejs";/u, file);
    assert.match(source, /export const dynamic = "force-dynamic";/u, file);
    const path = `/${file.replace(/^src\/app\//u, "").replace(/\/route\.ts$/u, "")}`
      .replace("[documentId]", ID(1)).replace("[page]", "2").replace("[itemId]", ID(30))
      .replace("[...object]", `${ORG}/${ID(1)}/original`);
    assert.equal(isConnectedPlatformApi(path), true, `${file} → ${path}`);
  }
});

async function loadBundledProxy() {
  const bundled = await build({
    entryPoints: [fileURLToPath(new URL("../src/proxy.ts", import.meta.url))],
    bundle: true, packages: "external", platform: "node", format: "cjs", write: false,
  });
  const loaded = { exports: {} };
  new Function("require", "module", "exports", bundled.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports);
  return loaded.exports.proxy;
}

test("real proxy: staff P2 APIs reach the session gate (401), the broker passes to its handler, near misses are 403", async () => {
  const proxy = await loadBundledProxy();
  const saved = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY };
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:45421";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_routing-boundary-only";
  const request = (path, method = "GET", host = "crm.evoadmissions.com") => new NextRequest(`https://${host}${path}`, { method, headers: { host } });
  try {
    for (const [method, path] of [["POST", STAFF_P2_APIS[0]], ["GET", STAFF_P2_APIS[1]], ["GET", STAFF_P2_APIS[3]],
      ["GET", STAFF_P2_APIS[4]], ["POST", STAFF_P2_APIS[5]], ["POST", STAFF_P2_APIS[6]], ["POST", STAFF_P2_APIS[7]]]) {
      const response = await proxy(request(path, method));
      assert.equal(response.status, 401, `${method} ${path}`);
      assert.deepEqual(await response.json(), { error: "authentication_required" }, `${method} ${path}`);
    }
    for (const path of BROKER_PATHS) {
      for (const method of ["GET", "PUT"]) {
        const response = await proxy(request(path, method, "evo-crm-app:3000"));
        assert.equal(response.headers.get("x-middleware-next"), "1", `${method} ${path}: reaches its own HMAC handler`);
      }
    }
    for (const path of P2_NEAR_MISSES) {
      const response = await proxy(request(path, "GET"));
      assert.equal(response.status, 403, path);
      assert.equal((await response.json()).error, "platform_route_not_connected", path);
    }
  } finally {
    if (saved.url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = saved.url;
    if (saved.key === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY; else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = saved.key;
  }
});

// ------------------------------------------------------------ env contract

test("env: the broker secret is optional, well-formed and distinct from the agent-call secret", () => {
  const example = read("deploy/env.production.example");
  assert.match(example, /^EVO_AI_AGENT_STORAGE_SECRET=$/mu);
  const contract = read("scripts/evo-app-env-contract.mjs");
  assert.match(contract, /OPTIONAL_RUNTIME_NAMES = Object\.freeze\(\["EVO_AI_AGENT_INTERNAL_SECRET", "EVO_AI_AGENT_STORAGE_SECRET"\]\)/u);
  assert.equal(typeof validateAppEnvironmentContract, "function");
});

// ------------------------------------------------------------ UI source

test("UI: five tabs with the review count, the upload copy, viewer, review sheet and lab; no Storage path in client code", () => {
  const views = read("src/components/v3/ai-agent/AiAgentViews.tsx");
  assert.match(views, /count: tab\.key === "review" \? reviewOpenCount : null/u);
  assert.match(views, /Новая версия обрабатывается — пока ищется прежняя\./u);
  assert.match(views, /Это материал компании — продолжить/u);
  const upload = read("src/components/v3/ai-agent/AiDocumentUpload.tsx");
  assert.match(upload, /Перетащите файл или/u);
  assert.match(upload, /Это материал компании, не документ клиента/u);
  assert.match(upload, /xhr\.open\("POST", "\/api\/v3\/ai-agent\/documents"\)/u);
  assert.match(read("src/lib/v3/ai-agent-knowledge.ts"), /PDF, DOCX, XLSX, CSV, TXT, MD, PNG, JPEG · до 25 МБ/u);
  // Адреса картинок совпадают с подключёнными маршрутами (урок 06.10).
  assert.equal(isConnectedPlatformApi(aiPageImageHref(ID(1), 2)), true);
  assert.equal(isConnectedPlatformApi(aiCropHref(ID(1), ID(30))), true);
  const viewer = read("src/components/v3/ai-agent/AiDocumentViewer.tsx");
  assert.match(viewer, /aiPageImageHref\(document\.id, page\.pageNo\)/u);
  const review = read("src/components/v3/ai-agent/AiReviewSheet.tsx") + read("src/components/v3/ai-agent/AiReviewItemActions.tsx");
  for (const word of ["Первое чтение", "Второе чтение", "Проверка фрагмента", "Предложено", "Подтвердить", "Исправить", "Оставить как есть", "Открыть снова", "Исправление применяется…", "Всё сверено"]) {
    assert.ok(review.includes(word), word);
  }
  const lab = read("src/components/v3/ai-agent/AiLaboratory.tsx");
  for (const word of ["Спросите как клиент", "Почему такой ответ", "Что не так?", "Предложить правку", "Было", "Стало", "Эталонный ответ", "Применить", "Не менять"]) {
    assert.ok(lab.includes(word), word);
  }
  // Без агента «Применить» нет из-за агента, а не из-за прав (Q9: права есть у всех).
  assert.match(lab, /agentOff=\{!featureOn\}/u);
  assert.match(lab, /ИИ-агент не подключён к CRM — применить правку сейчас нельзя\./u);
  assert.match(read("src/lib/v3/ai-agent-knowledge.ts"), /lab_changed: "Знания или предложение изменились\. Спросите заново\."/u);
  for (const file of ["AiDocumentUpload.tsx", "AiDocumentViewer.tsx", "AiReviewItemActions.tsx", "AiLaboratory.tsx"]) {
    const source = read(`src/components/v3/ai-agent/${file}`);
    assert.match(source, /^"use client";/u, file);
    assert.doesNotMatch(source, /imagePath|cropPath|platform-ai-agent-knowledge|supabase/u, `${file}: no Storage path or client`);
  }
  const page = read("src/app/(v3)/v3/ai-agent/page.tsx");
  assert.match(page, /const route = parseAiAgentRoute\(await searchParams\);\n  if \(!route\) notFound\(\);/u);
});
