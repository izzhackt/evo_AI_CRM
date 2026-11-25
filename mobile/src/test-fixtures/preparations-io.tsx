// Устройство документов программы для тестов экрана: выбор файла, отпечаток, загрузка и скачивание подставлены, сети нет.
import { createHash } from "node:crypto";

import type { ApplicationDocumentUploadIntent, ApplicationDocumentUploadResult } from "@web/lib/portal/application-documents";

import type { PickedFile } from "@/domain/documents-model";
import type { DownloadDeps } from "@/features/documents/download";
import type { NotSentFailure } from "@/features/preparations/document-commands";
import type { PreparationIo } from "@/features/preparations/io";
import { uploadId, versionId } from "@/test-fixtures/preparations";

export const FILE_BYTES = new TextEncoder().encode("%PDF-1.7 синтетический файл для теста");
export const FILE_DIGEST = createHash("sha256").update(FILE_BYTES).digest("hex");
export const PICKED: PickedFile = { uri: "file:///cache/picker/справка.pdf", name: "справка.pdf", size: FILE_BYTES.byteLength, mimeType: "application/pdf", source: "file" };
export const OTHER_PICKED: PickedFile = { uri: "file:///cache/picker/другой.pdf", name: "другой.pdf", size: 5, mimeType: "application/pdf", source: "file" };
export const OTHER_DIGEST = createHash("sha256").update("другой").digest("hex");

export const receiptFor = (intent: ApplicationDocumentUploadIntent, n = 7) => ({
  ...intent,
  uploadContextId: uploadId(n),
  documentVersionId: versionId(n),
  versionNo: "1",
  finalizedAt: "2026-10-26T10:00:00+00:00",
  publishedToLegacySlot: false as const,
});

type FakeFetch = Awaited<ReturnType<DownloadDeps["fetchImpl"]>>;
/** Итог подставленной загрузки: ответ сервера или сбой до отправки. */
type UploadResult = ApplicationDocumentUploadResult | NotSentFailure;

export type FakeIo = Readonly<{
  io: PreparationIo;
  uploads: ApplicationDocumentUploadIntent[];
  opened: string[];
  fetches: { url: string; headers: Record<string, string> }[];
}>;

export function makeIo(options: {
  picks?: PickedFile[];
  upload?: (intent: ApplicationDocumentUploadIntent) => UploadResult | Promise<UploadResult>;
  over?: Partial<PreparationIo>;
  fetchResponses?: FakeFetch[];
} = {}): FakeIo {
  const uploads: ApplicationDocumentUploadIntent[] = [];
  const opened: string[] = [];
  const fetches: { url: string; headers: Record<string, string> }[] = [];
  const picks = [...(options.picks ?? [])];
  const responses = [...(options.fetchResponses ?? [])];
  const io: PreparationIo = {
    pick: jest.fn(async () => ({ kind: "picked" as const, file: picks.shift() ?? PICKED })),
    fingerprint: async (file) => (file.name === OTHER_PICKED.name ? { byteSize: 5, sha256Hex: OTHER_DIGEST } : { byteSize: FILE_BYTES.byteLength, sha256Hex: FILE_DIGEST }),
    createUploader: () => async ({ intent, onProgress }) => {
      uploads.push(intent);
      onProgress?.(50);
      return options.upload ? options.upload(intent) : { ok: true, receipt: receiptFor(intent) as never };
    },
    createDownloadDeps: () => ({
      baseUrl: "https://portal.example.test",
      getToken: async () => "synthetic-token",
      fetchImpl: async (url, init) => {
        fetches.push({ url, headers: init.headers });
        const next = responses.shift();
        if (next) return next;
        return { status: 200, ok: true, headers: new Headers({ "content-type": "application/pdf" }), arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
      },
      writeFile: async (name) => `file:///cache/${name}`,
    }),
    openLocalFile: jest.fn(async (uri: string) => void opened.push(uri)),
    ...options.over,
  };
  return { io, uploads, opened, fetches };
}
