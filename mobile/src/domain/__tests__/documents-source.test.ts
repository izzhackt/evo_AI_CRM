import { readFileSync } from "node:fs";
import path from "node:path";

import {
  CASE_FILE_KINDS,
  DOCUMENT_REVIEW_DECISIONS,
  DOCUMENT_SLOT_STATUSES,
  decodeCaseFiles,
  decodeDocuments,
  normalizeStudentPortalCaseFile,
  normalizeStudentPortalDocument,
  PortalDecodeError,
} from "@/domain/portal-source";
import { CASE_FILE_ROW, DOCUMENT_ROW_CORRECTION, DOCUMENT_ROW_EMPTY, FILE_ID, SLOT_ID, VERSION_ID } from "@/test-fixtures/rpc-rows";

const rejects = (fn: () => unknown) => expect(fn).toThrow(PortalDecodeError);

/** Массив `export const NAME = [...] as const` из исходника веба (модуль целиком тянет серверные зависимости). */
function webList(name: string): string[] {
  const source = readFileSync(path.resolve(__dirname, "../../../../src/lib/platform-private-documents.ts"), "utf8");
  const match = new RegExp(`export const ${name} = \\[([^\\]]*)\\] as const`).exec(source);
  if (!match) throw new Error(`нет ${name}`);
  return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

describe("паритет перечислений с вебом", () => {
  it("статусы слота и решения совпадают", () => {
    expect([...DOCUMENT_SLOT_STATUSES]).toEqual(webList("PLATFORM_DOCUMENT_SLOT_STATUSES"));
    expect([...DOCUMENT_REVIEW_DECISIONS]).toEqual(webList("PLATFORM_DOCUMENT_REVIEW_DECISIONS"));
    expect([...CASE_FILE_KINDS]).toEqual(["contract", "receipt", "pending_receipt"]);
  });
});

describe("чек-лист документов", () => {
  it("слот без файла", () => {
    const doc = normalizeStudentPortalDocument(DOCUMENT_ROW_EMPTY);
    expect(doc).toMatchObject({ documentSlotId: SLOT_ID, status: "required", documentVersionId: null, originalFilename: null, byteSize: null });
    expect(Object.isFrozen(doc)).toBe(true);
  });
  it("слот с файлом и замечанием", () => {
    expect(normalizeStudentPortalDocument(DOCUMENT_ROW_CORRECTION)).toMatchObject({
      documentVersionId: VERSION_ID,
      versionNo: "2",
      byteSize: 123456,
      declaredMimeType: "application/pdf",
      reviewDecision: "correction_required",
      reworkReason: "Фото не видно",
    });
  });
  it.each([
    ["лишнее поле", { ...DOCUMENT_ROW_EMPTY, path: "x" }],
    ["нет поля", Object.fromEntries(Object.entries(DOCUMENT_ROW_EMPTY).filter(([k]) => k !== "deadline"))],
    ["неизвестный статус", { ...DOCUMENT_ROW_EMPTY, slot_status: "weird" }],
    ["файл без версии", { ...DOCUMENT_ROW_EMPTY, original_filename: "a.pdf" }],
    ["версия без файла", { ...DOCUMENT_ROW_CORRECTION, original_filename: null }],
    ["решение без файла", { ...DOCUMENT_ROW_EMPTY, review_decision: "approved", reviewed_at: "2026-09-06T08:00:00+00:00" }],
    ["замечание без причины", { ...DOCUMENT_ROW_CORRECTION, rework_reason: null }],
    ["принято с причиной", { ...DOCUMENT_ROW_CORRECTION, review_decision: "approved" }],
    ["чужой mime", { ...DOCUMENT_ROW_CORRECTION, declared_mime_type: "text/html" }],
    ["нулевой размер", { ...DOCUMENT_ROW_CORRECTION, byte_size: 0 }],
    ["nil UUID", { ...DOCUMENT_ROW_EMPTY, document_slot_id: "00000000-0000-0000-0000-000000000000" }],
    ["ключ с заглавной", { ...DOCUMENT_ROW_EMPTY, requirement_key: "Passport" }],
  ])("отклоняет: %s", (_name, row) => rejects(() => normalizeStudentPortalDocument(row)));
  it("список: не массив и повтор слота отклоняются", () => {
    expect(decodeDocuments([])).toEqual([]);
    rejects(() => decodeDocuments({}));
    rejects(() => decodeDocuments([DOCUMENT_ROW_EMPTY, DOCUMENT_ROW_EMPTY]));
  });
});

describe("договор и чеки", () => {
  it("разбирает строку", () => {
    expect(normalizeStudentPortalCaseFile(CASE_FILE_ROW)).toEqual({ kind: "contract", fileId: FILE_ID, originalFilename: "contract.pdf", declaredMimeType: "application/pdf", byteSize: 2048, addedAt: "2026-09-01T08:00:00+00:00" });
    expect(decodeCaseFiles([CASE_FILE_ROW, { ...CASE_FILE_ROW, file_kind: "receipt" }])).toHaveLength(2);
  });
  it.each([
    ["вид", { ...CASE_FILE_ROW, file_kind: "invoice" }],
    ["путь Storage", { ...CASE_FILE_ROW, object_name: "a/b" }],
    ["размер", { ...CASE_FILE_ROW, byte_size: -1 }],
  ])("отклоняет: %s", (_name, row) => rejects(() => normalizeStudentPortalCaseFile(row)));
  it("повтор вида и id отклоняется", () => rejects(() => decodeCaseFiles([CASE_FILE_ROW, CASE_FILE_ROW])));
});
