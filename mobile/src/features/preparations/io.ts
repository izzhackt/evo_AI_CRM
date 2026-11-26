// Устройство, нужное документам программы, одним объектом: тест подменяет его целиком, приложение берёт настоящее.
// Выбор файла, скачивание и открытие скачанного - те же, что у экрана «Документы» (`features/documents/io.ts`).
import { nativeDocumentsIo, type DocumentsIo } from "@/features/documents/io";
import type { UploadFn } from "@/features/preparations/document-commands";
import { createProgramUploader, fingerprintFile } from "@/features/preparations/native";
import type { Fingerprinter } from "@/features/preparations/upload-protocol";

export type PreparationIo = Readonly<{
  pick: DocumentsIo["pick"];
  fingerprint: Fingerprinter;
  createUploader: (baseUrl: string, getToken: () => Promise<string | null>, refreshToken?: () => Promise<string | null>) => UploadFn;
  createDownloadDeps: DocumentsIo["createDownloadDeps"];
  openLocalFile: DocumentsIo["openLocalFile"];
}>;

export const nativePreparationIo: PreparationIo = {
  pick: nativeDocumentsIo.pick,
  fingerprint: fingerprintFile,
  createUploader: createProgramUploader,
  createDownloadDeps: nativeDocumentsIo.createDownloadDeps,
  openLocalFile: nativeDocumentsIo.openLocalFile,
};
