// Нативные операции экрана «Документы» одним объектом: тест подменяет его целиком,
// приложение берёт настоящие из native.ts.
import type { PickSource } from "@/domain/documents-model";
import type { DownloadDeps } from "@/features/documents/download";
import * as native from "@/features/documents/native";
import type { PickOutcome } from "@/features/documents/native";
import type { UploadSend } from "@/features/documents/upload-controller";

export type DocumentsIo = Readonly<{
  pick: (source: PickSource) => Promise<PickOutcome>;
  createUploadSend: (baseUrl: string, getToken: () => Promise<string | null>) => UploadSend;
  createDownloadDeps: (baseUrl: string, getToken: () => Promise<string | null>) => DownloadDeps;
  openLocalFile: (uri: string, mimeType: string) => Promise<void>;
}>;

export const nativeDocumentsIo: DocumentsIo = {
  pick: (source) => (source === "file" ? native.pickFromFiles() : source === "photo" ? native.pickFromPhotos() : native.pickFromCamera()),
  createUploadSend: native.createUploadSend,
  createDownloadDeps: native.createDownloadDeps,
  openLocalFile: native.openLocalFile,
};
