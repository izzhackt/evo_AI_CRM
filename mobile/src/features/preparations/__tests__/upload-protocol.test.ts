// Протокол загрузки программного документа: заголовок, замороженный запрос, разбор ответа. Заголовок и ответ сверены с настоящим
// модулем веба (`application-documents-upload.ts`), который приложению подключать нельзя (страж общих импортов).
import { createHash } from "node:crypto";

import {
  parseApplicationDocumentUploadIntent,
  type ApplicationDocumentUploadIntent,
} from "@web/lib/portal/application-documents";

import type { PickedFile } from "@/domain/documents-model";
import {
  UPLOAD_HEADER_MAX,
  UPLOAD_INTENT_HEADER,
  UPLOAD_METADATA_MAX,
  UPLOAD_PATH,
  UPLOAD_TRANSPORT_FILENAME,
  encodeUploadHeader,
  freezeUploadIntent,
  parseUploadResponse,
  sameUploadIntent,
  type Fingerprinter,
} from "@/features/preparations/upload-protocol";
import { APPLICATION_ID, REVISION_ID, STUDENT_CASE_ID, itemId, slotId, uploadId, versionId, sha } from "@/test-fixtures/preparations";

type WebUpload = {
  encodeApplicationDocumentUploadHeader: (value: unknown) => string | null;
  decodeApplicationDocumentUploadHeader: (value: unknown) => unknown;
  uploadApplicationDocumentFile: (input: { audience: "student" | "staff"; intent: ApplicationDocumentUploadIntent; file: unknown }) => Promise<unknown>;
};
// requireActual: модуль веба трогает `document` и `XMLHttpRequest`; импортом в приложении он запрещён стражем общих импортов.
const web = jest.requireActual("@web/lib/portal/application-documents-upload") as WebUpload;
// Константы и правила имени веба: приложение сверяется с ними, а не с собой (опечатка в константе приложения иначе осталась бы незамеченной).
const webConstants = jest.requireActual("@web/lib/portal/application-documents-upload") as {
  APPLICATION_DOCUMENT_UPLOAD_HEADER: string;
  APPLICATION_DOCUMENT_UPLOAD_HEADER_MAX: number;
  APPLICATION_DOCUMENT_UPLOAD_METADATA_MAX: number;
  APPLICATION_DOCUMENT_TRANSPORT_FILENAME: string;
};
const webRoutes = jest.requireActual("@web/lib/platform-route-contract") as { isConnectedStudentPortalApi: (path: string, method: string) => boolean };
const webFilename = (jest.requireActual("@web/lib/portal/application-documents") as { applicationDocumentFilename: (value: unknown) => boolean }).applicationDocumentFilename;

const target = { studentCaseId: STUDENT_CASE_ID, applicationId: APPLICATION_ID, requirementsRevisionId: REVISION_ID, requirementItemId: itemId(0), documentSlotId: slotId(0) };
const REQUEST = "99999999-0000-4000-8000-000000000001";
const bytes = new TextEncoder().encode("%PDF-1.4 синтетический файл для теста");
const digest = createHash("sha256").update(bytes).digest("hex");
const picked = (over: Partial<PickedFile> = {}): PickedFile => ({ uri: "file:///cache/Скан паспорта.pdf", name: "Скан паспорта.pdf", size: bytes.byteLength, mimeType: "application/pdf", source: "file", ...over });
const fingerprint: Fingerprinter = async () => ({ byteSize: bytes.byteLength, sha256Hex: digest });

async function frozen(over: Partial<PickedFile> = {}, requestId = REQUEST) {
  const result = await freezeUploadIntent({ target, file: picked(over), requestId, fingerprint });
  if (result.status !== "frozen") throw new Error(`не заморозился: ${result.status}`);
  return result.intent;
}
const statusOf = async (input: Partial<Parameters<typeof freezeUploadIntent>[0]> = {}) => (await freezeUploadIntent({ target, file: picked(), requestId: REQUEST, fingerprint, ...input })).status;

describe("константы протокола сверены с вебом и закреплены буквами", () => {
  it("заголовок запроса, имя файла в части, пределы заголовка", () => {
    expect(UPLOAD_INTENT_HEADER).toBe("X-EVO-Upload-Intent");
    expect(UPLOAD_INTENT_HEADER).toBe(webConstants.APPLICATION_DOCUMENT_UPLOAD_HEADER);
    expect(UPLOAD_TRANSPORT_FILENAME).toBe("upload");
    expect(UPLOAD_TRANSPORT_FILENAME).toBe(webConstants.APPLICATION_DOCUMENT_TRANSPORT_FILENAME);
    expect(UPLOAD_HEADER_MAX).toBe(webConstants.APPLICATION_DOCUMENT_UPLOAD_HEADER_MAX);
    expect(UPLOAD_METADATA_MAX).toBe(webConstants.APPLICATION_DOCUMENT_UPLOAD_METADATA_MAX);
  });

  it("адрес загрузки: тот, что сервер принимает от студента по Bearer (контракт маршрутов веба), и только POST", () => {
    expect(UPLOAD_PATH).toBe("/api/portal/application-document-uploads");
    expect(webRoutes.isConnectedStudentPortalApi(UPLOAD_PATH, "POST")).toBe(true);
    expect(webRoutes.isConnectedStudentPortalApi(UPLOAD_PATH, "GET")).toBe(false);
  });
});

describe("замороженный запрос", () => {
  it("цель, тип, размер и SHA-256 содержимого, id запроса сохранён как есть", async () => {
    expect(await frozen()).toEqual({
      protocolVersion: 1,
      ...target,
      requestId: REQUEST,
      file: { originalFilename: "Скан паспорта.pdf", declaredMimeType: "application/pdf", byteSize: String(bytes.byteLength), sha256Hex: digest },
    });
  });

  it("размер берётся из байтов, а не из ответа выбора файла", async () => {
    const intent = await frozen({ size: 123 });
    expect(intent.file.byteSize).toBe(String(bytes.byteLength));
  });

  it("имя приводится к безопасному и получает расширение по типу; одно и то же для одного и того же файла", async () => {
    const a = await frozen({ name: "IMG/0001:раз?.HEIC", mimeType: "image/jpeg", uri: "file:///c/x.jpg" });
    const b = await frozen({ name: "IMG/0001:раз?.HEIC", mimeType: "image/jpeg", uri: "file:///c/y.jpg" });
    expect(a.file.originalFilename).toBe("IMG_0001_раз_.HEIC.jpg");
    expect(a.file.originalFilename).toBe(b.file.originalFilename);
    expect(a.file.declaredMimeType).toBe("image/jpeg");
    expect((await frozen({ name: "  ", mimeType: "image/png", uri: "file:///c/z" })).file.originalFilename).toBe("document.png");
  });

  it("тип определяется по расширению, если выбор файла его не назвал; чужие типы не годятся", async () => {
    expect((await frozen({ mimeType: null, name: "scan.JPEG" })).file.declaredMimeType).toBe("image/jpeg");
    for (const bad of [{ mimeType: "image/heic", name: "a.heic" }, { mimeType: "image/gif", name: "a.gif" }, { mimeType: null, name: "a.docx" }]) {
      expect(await statusOf({ file: picked(bad) })).toBe("invalid");
    }
  });

  it("пустой файл и файл больше 25 МБ не годятся ни по ответу выбора, ни по байтам", async () => {
    expect(await statusOf({ file: picked({ size: 0 }) })).toBe("invalid");
    expect(await statusOf({ file: picked({ size: 25 * 1024 * 1024 + 1 }) })).toBe("invalid");
    for (const byteSize of [0, 25 * 1024 * 1024 + 1, 1.5]) {
      expect(await statusOf({ fingerprint: async () => ({ byteSize, sha256Hex: digest }) })).toBe("invalid");
    }
    const edge = await freezeUploadIntent({ target, file: picked({ size: 25 * 1024 * 1024 }), requestId: REQUEST, fingerprint: async () => ({ byteSize: 25 * 1024 * 1024, sha256Hex: digest }) });
    expect(edge.status === "frozen" && edge.intent.file.byteSize).toBe(String(25 * 1024 * 1024));
  });

  it("байты не прочитались - это «не прочитался», а не «не годится»; негодный отпечаток - «не годится»", async () => {
    expect(await statusOf({ fingerprint: async () => { throw new Error("нет файла"); } })).toBe("unreadable");
    expect(await statusOf({ fingerprint: async () => ({ byteSize: 10, sha256Hex: "не хэш" }) })).toBe("invalid");
  });

  it("негодная цель и негодный id запроса: файла нет", async () => {
    expect(await statusOf({ target: { ...target, applicationId: "x" } })).toBe("invalid");
    expect(await statusOf({ requestId: "не uuid" })).toBe("invalid");
  });

  it("неподходящий файл не читается вовсе: отпечаток не считается, пока тип, размер и цель не проверены", async () => {
    let reads = 0;
    const counting: Fingerprinter = async () => {
      reads += 1;
      return { byteSize: bytes.byteLength, sha256Hex: digest };
    };
    expect(await statusOf({ file: picked({ mimeType: "image/heic", name: "a.heic" }), fingerprint: counting })).toBe("invalid");
    expect(reads).toBe(0);
    expect(await statusOf({ fingerprint: counting })).toBe("frozen");
    expect(reads).toBe(1);
  });

  it("запрос принимается разборщиком веба", async () => {
    expect(parseApplicationDocumentUploadIntent(await frozen())).toEqual(await frozen());
  });

  it("sameUploadIntent: совпадает только полностью", async () => {
    const a = await frozen();
    expect(sameUploadIntent(a, await frozen())).toBe(true);
    expect(sameUploadIntent(a, await frozen({}, "99999999-0000-4000-8000-000000000002"))).toBe(false);
    expect(sameUploadIntent(a, await frozen({ name: "другой.pdf" }))).toBe(false);
    expect(sameUploadIntent(a, { ...a, file: { ...a.file, sha256Hex: sha(5) } })).toBe(false);
    expect(sameUploadIntent(a, { ...a, file: { ...a.file, byteSize: "1" } })).toBe(false);
    expect(sameUploadIntent(a, { ...a, file: { ...a.file, declaredMimeType: "image/png" } })).toBe(false);
    expect(sameUploadIntent(a, { ...a, documentSlotId: slotId(3) })).toBe(false);
    expect(sameUploadIntent(a, { ...a, requirementsRevisionId: slotId(4) })).toBe(false);
  });
});

describe("имя файла проходит правила веба (`applicationDocumentFilename`)", () => {
  const emoji = "\u{1F600}"; // два знака UTF-16
  const wellFormed = (value: string) => {
    try {
      encodeURIComponent(value); // бросает на одинокой половине суррогатной пары
      return true;
    } catch {
      return false;
    }
  };
  const nameOf = async (name: string) => (await frozen({ name })).file.originalFilename;

  it("эмодзи на границе обрезки не разрезается: ни одинокой половины, имя принимает веб", async () => {
    // 119 букв и эмодзи: сто двадцатая единица UTF-16 пришлась бы на середину пары
    const filename = await nameOf(`${"а".repeat(119)}${emoji}${"б".repeat(30)}.pdf`);
    expect(filename).toBe(`${"а".repeat(119)}${emoji}.pdf`);
    expect(wellFormed(filename)).toBe(true);
    expect(webFilename(filename)).toBe(true);
  });

  it("длина по знакам, а не по единицам UTF-16: сто двадцать эмодзи остаются целыми", async () => {
    const filename = await nameOf(`${emoji.repeat(130)}.pdf`);
    expect(Array.from(filename.replace(/\.pdf$/u, ""))).toHaveLength(120);
    expect(wellFormed(filename)).toBe(true);
    expect(webFilename(filename)).toBe(true);
  });

  it("управляющие знаки C1 (U+0080-U+009F) убираются: имя принимает веб, а не отказ «Выберите PDF…»", async () => {
    const filename = await nameOf("ск\u0085а\u009Fн\u0080.pdf");
    expect(filename).toBe("скан.pdf");
    expect(webFilename(filename)).toBe(true);
  });

  it("после обрезки пробел на краю не остаётся (веб требует имя без пробелов по краям)", async () => {
    const filename = await nameOf(`${"а".repeat(119)} ${"б".repeat(5)}.pdf`);
    expect(filename).toBe(`${"а".repeat(119)}.pdf`);
    expect(webFilename(filename)).toBe(true);
  });

  it("одинокая половина пары во входном имени убирается", async () => {
    expect(await nameOf("ска\uD83Dн\uDE00.pdf")).toBe("скан.pdf");
  });

  it("любое трудное имя даёт имя, которое принимает веб", async () => {
    const names = ["\u0085", "\u009F.pdf", `${emoji}`.repeat(200), "а".repeat(500), ` ${"я".repeat(125)} .jpg`, "..\\..\\x\u0085.pdf", "\u007Fа\u0080"];
    for (const name of names) {
      const filename = await nameOf(name);
      expect([name, wellFormed(filename), webFilename(filename)]).toEqual([name, true, true]);
    }
  });
});

describe("заголовок запроса", () => {
  it("совпадает с тем, что строит веб, строка в строку, и читается серверным разбором веба", async () => {
    const intent = await frozen();
    const header = { protocolVersion: 1 as const, ...target, file: intent.file };
    const mine = encodeUploadHeader(header);
    expect(mine).toBe(web.encodeApplicationDocumentUploadHeader(header));
    expect(mine).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(web.decodeApplicationDocumentUploadHeader(mine)).toEqual(header);
  });

  it("порядок ключей на заголовок не влияет", async () => {
    const intent = await frozen();
    const shuffled = { file: { sha256Hex: intent.file.sha256Hex, byteSize: intent.file.byteSize, declaredMimeType: intent.file.declaredMimeType, originalFilename: intent.file.originalFilename }, documentSlotId: target.documentSlotId, requirementItemId: target.requirementItemId, requirementsRevisionId: target.requirementsRevisionId, applicationId: target.applicationId, studentCaseId: target.studentCaseId, protocolVersion: 1 as const };
    expect(encodeUploadHeader(shuffled)).toBe(encodeUploadHeader({ protocolVersion: 1, ...target, file: intent.file }));
  });

  it("негодное описание и слишком длинное имя не кодируются", async () => {
    const intent = await frozen();
    expect(encodeUploadHeader({ protocolVersion: 1, ...target, file: { ...intent.file, byteSize: "0" } })).toBeNull();
    expect(encodeUploadHeader({ protocolVersion: 1, ...target, file: { ...intent.file, originalFilename: "а/б" } })).toBeNull();
    expect(encodeUploadHeader({ protocolVersion: 1, ...target, file: { ...intent.file, originalFilename: "я".repeat(256) } })).toBeNull();
    expect(UPLOAD_HEADER_MAX).toBe(8192);
    expect(UPLOAD_METADATA_MAX).toBe(6144);
    // 255 букв по два байта: 510 байт имени, заголовок укладывается
    expect(encodeUploadHeader({ protocolVersion: 1, ...target, file: { ...intent.file, originalFilename: "я".repeat(255) } })).not.toBeNull();
  });
});

describe("ответ сервера", () => {
  async function receiptBody(intent: ApplicationDocumentUploadIntent) {
    return { upload: { protocolVersion: 1, ...target, requestId: intent.requestId, uploadContextId: uploadId(1), documentVersionId: versionId(1), versionNo: "1", file: intent.file, finalizedAt: "2026-10-07T10:00:00+00:00", publishedToLegacySlot: false } };
  }

  it("201 с точной квитанцией - успех", async () => {
    const intent = await frozen();
    const result = parseUploadResponse(201, await receiptBody(intent), intent);
    expect(result).toMatchObject({ ok: true, receipt: { requestId: REQUEST, uploadContextId: uploadId(1), documentVersionId: versionId(1), versionNo: "1" } });
  });

  it("201 с чужой квитанцией, лишними полями или пустым телом - результат неизвестен, запрос остаётся", async () => {
    const intent = await frozen();
    const good = await receiptBody(intent);
    const cases: unknown[] = [
      null,
      {},
      { upload: { ...good.upload, requestId: "99999999-0000-4000-8000-000000000009" } },
      { upload: { ...good.upload, publishedToLegacySlot: true } },
      { upload: { ...good.upload, file: { ...intent.file, sha256Hex: sha(9) } } },
      { ...good, extra: 1 },
      "строка",
    ];
    for (const body of cases) expect(parseUploadResponse(201, body, intent)).toEqual({ ok: false, reason: "unavailable", resolution: "retain" });
  });

  it("ошибка из закрытого списка: «не записано» верится, кроме запрета и конфликта запроса", async () => {
    const intent = await frozen();
    const error = (code: string, resolution: string) => ({ error: { code, resolution } });
    expect(parseUploadResponse(409, error("stale_context", "not_written"), intent)).toEqual({ ok: false, reason: "stale_context", resolution: "not_written" });
    expect(parseUploadResponse(422, error("malware_detected", "not_written"), intent)).toEqual({ ok: false, reason: "malware_detected", resolution: "not_written" });
    expect(parseUploadResponse(503, error("unavailable", "retain"), intent)).toEqual({ ok: false, reason: "unavailable", resolution: "retain" });
    expect(parseUploadResponse(403, error("forbidden", "not_written"), intent)).toEqual({ ok: false, reason: "forbidden", resolution: "retain" });
    expect(parseUploadResponse(409, error("request_conflict", "not_written"), intent)).toEqual({ ok: false, reason: "request_conflict", resolution: "retain" });
  });

  it("ошибка не из списка, с лишним полем или с чужим решением разбирается по статусу", async () => {
    const intent = await frozen();
    const byStatus: [number, string][] = [[400, "invalid"], [403, "forbidden"], [409, "request_conflict"], [413, "file_too_large"], [415, "unsupported_type"], [422, "malware_detected"], [429, "rate_limited"], [401, "unavailable"], [500, "unavailable"], [503, "unavailable"], [200, "unavailable"], [204, "unavailable"]];
    for (const [status, reason] of byStatus) expect(parseUploadResponse(status, null, intent)).toEqual({ ok: false, reason, resolution: "retain" });
    expect(parseUploadResponse(409, { error: { code: "что-то", resolution: "not_written" } }, intent)).toEqual({ ok: false, reason: "request_conflict", resolution: "retain" });
    expect(parseUploadResponse(409, { error: { code: "stale_context", resolution: "maybe" } }, intent)).toEqual({ ok: false, reason: "request_conflict", resolution: "retain" });
    expect(parseUploadResponse(409, { error: { code: "stale_context", resolution: "not_written", extra: 1 } }, intent)).toEqual({ ok: false, reason: "request_conflict", resolution: "retain" });
    // статус вне 400-599 с ошибкой в теле не считается отказом из списка
    expect(parseUploadResponse(302, { error: { code: "stale_context", resolution: "not_written" } }, intent)).toEqual({ ok: false, reason: "unavailable", resolution: "retain" });
  });

  it("совпадает с настоящим ответом веба на тех же статусах и телах", async () => {
    const intent = await frozen();
    const receipt = await receiptBody(intent);
    const cases: [number, unknown][] = [
      [201, receipt],
      [201, { upload: { ...receipt.upload, versionNo: "0" } }],
      [201, null],
      [409, { error: { code: "stale_context", resolution: "not_written" } }],
      [403, { error: { code: "forbidden", resolution: "not_written" } }],
      [503, { error: { code: "unavailable", resolution: "retain" } }],
      [400, null],
      [401, null],
      [413, null],
      [415, null],
      [422, { error: { code: "malware_detected", resolution: "not_written" } }],
      [429, { error: { code: "rate_limited", resolution: "retain" } }],
      [500, null],
    ];
    const savedXhr = (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest;
    const savedFile = (globalThis as { File?: unknown }).File;
    const savedForm = (globalThis as { FormData?: unknown }).FormData;
    try {
      class FakeFile {
        name: string;
        type: string;
        size: number;
        constructor(parts: BlobPart[], name: string, options: { type?: string }) {
          this.name = name;
          this.type = options.type ?? "";
          this.size = parts.reduce<number>((total, part) => total + (part as Uint8Array).byteLength, 0);
        }
        async arrayBuffer() {
          return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        }
      }
      (globalThis as { File?: unknown }).File = FakeFile;
      (globalThis as { FormData?: unknown }).FormData = class { append() {} };
      for (const [status, body] of cases) {
        class FakeXhr {
          upload: { onprogress: unknown } = { onprogress: null };
          responseType = "";
          response: unknown = body;
          status = status;
          onload: (() => void) | null = null;
          onerror: (() => void) | null = null;
          onabort: (() => void) | null = null;
          ontimeout: (() => void) | null = null;
          open() {}
          setRequestHeader() {}
          send() {
            queueMicrotask(() => this.onload?.());
          }
        }
        (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest = FakeXhr;
        const file = new FakeFile([bytes], intent.file.originalFilename, { type: intent.file.declaredMimeType });
        const theirs = await web.uploadApplicationDocumentFile({ audience: "student", intent, file });
        expect([status, parseUploadResponse(status, body, intent)]).toEqual([status, theirs]);
      }
    } finally {
      (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest = savedXhr;
      (globalThis as { File?: unknown }).File = savedFile;
      (globalThis as { FormData?: unknown }).FormData = savedForm;
    }
  });
});
