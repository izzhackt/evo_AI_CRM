// Нативные части документов программы: отпечаток файла и отправка multipart с Bearer. Правила протокола живут в
// `upload-protocol.ts` и проверяются без устройства; здесь только чтение байтов, копия файла и вызов загрузки.
// API по версионной документации Expo SDK 58: expo-file-system (File, Directory, Paths, UploadType) и expo-crypto (digest).
import * as Crypto from "expo-crypto";
import { Directory, File, Paths, UploadType } from "expo-file-system";
import { randomUUID } from "expo-crypto";

import { progressPercent } from "@/domain/documents-model";
import { UPLOAD_STAGE_DIR } from "@/features/documents/download-cache";
import type { UploadFn } from "@/features/preparations/document-commands";
import {
  UPLOAD_INTENT_HEADER,
  UPLOAD_PATH,
  UPLOAD_TRANSPORT_FILENAME,
  encodeUploadHeader,
  parseUploadResponse,
  type Fingerprinter,
} from "@/features/preparations/upload-protocol";

/** Шестнадцатеричная запись байтов (SHA-256 -> 64 знака, как `sha256Hex` веба). */
export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Размер и SHA-256 по самим байтам файла (до 25 МБ целиком в памяти: `expo-crypto` считает отпечаток от готового буфера). */
export const fingerprintFile: Fingerprinter = async (file) => {
  const buffer = await new File(file.uri).arrayBuffer();
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, buffer);
  return { byteSize: buffer.byteLength, sha256Hex: toHex(new Uint8Array(digest)) };
};

/**
 * Multipart POST `/api/portal/application-document-uploads`: поле `file`, Bearer, `Idempotency-Key` и `X-EVO-Upload-Intent`.
 * Сервер принимает только часть с именем `upload` и тем же типом, размером и SHA-256, что в запросе, поэтому выбранный файл
 * сначала копируется байт в байт в свой подкаталог кэша под именем `upload`. На 401 сессия обновляется один раз и уходит
 * тот же запрос (тот же ключ и заголовок). Сбой связи или чтения - `unavailable`: запись могла дойти, запрос остаётся.
 */
export function createProgramUploader(baseUrl: string, getToken: () => Promise<string | null>, refreshToken?: () => Promise<string | null>): UploadFn {
  return async ({ intent, file, onProgress }) => {
    const header = encodeUploadHeader({ protocolVersion: 1, studentCaseId: intent.studentCaseId, applicationId: intent.applicationId, requirementsRevisionId: intent.requirementsRevisionId, requirementItemId: intent.requirementItemId, documentSlotId: intent.documentSlotId, file: intent.file });
    if (!header) return { ok: false, reason: "invalid", resolution: "retain" };
    const stage = new Directory(Paths.cache, UPLOAD_STAGE_DIR, randomUUID());
    try {
      const first = await getToken();
      if (!first) return { ok: false, reason: "unavailable", resolution: "retain" };
      stage.create({ intermediates: true });
      const staged = new File(stage, UPLOAD_TRANSPORT_FILENAME);
      new File(file.uri).copy(staged);
      const post = (token: string) =>
        staged
          .createUploadTask(`${baseUrl}${UPLOAD_PATH}`, {
            uploadType: UploadType.MULTIPART,
            fieldName: "file",
            mimeType: intent.file.declaredMimeType,
            headers: { Authorization: `Bearer ${token}`, "Idempotency-Key": intent.requestId, [UPLOAD_INTENT_HEADER]: header, Accept: "application/json" },
            onProgress: ({ bytesSent, totalBytes }) => {
              const percent = progressPercent(bytesSent, totalBytes);
              if (percent !== null) onProgress?.(percent);
            },
          })
          .uploadAsync();
      let result = await post(first);
      if (result.status === 401 && refreshToken) {
        const renewed = await refreshToken();
        if (renewed) result = await post(renewed);
      }
      let body: unknown = null;
      try {
        body = JSON.parse(result.body);
      } catch {
        body = null;
      }
      return parseUploadResponse(result.status, body, intent);
    } catch {
      return { ok: false, reason: "unavailable", resolution: "retain" };
    } finally {
      try {
        if (stage.exists) stage.delete();
      } catch {
        // промежуточная копия уйдёт вместе с очисткой кэша
      }
    }
  };
}
