// Нативные части документов программы: отпечаток файла и отправка multipart с Bearer. Правила протокола живут в
// `upload-protocol.ts` и проверяются без устройства; здесь только чтение байтов, копия файла и вызов загрузки.
// API по версионной документации Expo SDK 58: expo-file-system (File, Directory, Paths, UploadType) и expo-crypto (digest).
import * as Crypto from "expo-crypto";
import { Directory, File, Paths, UploadType } from "expo-file-system";
import { randomUUID } from "expo-crypto";

import { progressPercent } from "@/domain/documents-model";
import { UPLOAD_STAGE_DIR } from "@/features/documents/download-cache";
import type { NotSentFailure, UploadFn } from "@/features/preparations/document-commands";
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

/**
 * Размер и SHA-256 по самим байтам файла (до 25 МБ целиком в памяти: `expo-crypto` считает отпечаток от готового буфера).
 * Размер по файловой системе после чтения должен совпасть с числом прочитанных байтов: иначе файл менялся во время чтения
 * (камера дописывает, облако докачивает), и отпечаток такого файла не годится, поэтому ошибка, а не молчаливый отпечаток.
 */
export const fingerprintFile: Fingerprinter = async (file) => {
  const source = new File(file.uri);
  const buffer = await source.arrayBuffer();
  if (buffer.byteLength !== source.size) throw new Error("file_changed_while_reading");
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, buffer);
  return { byteSize: buffer.byteLength, sha256Hex: toHex(new Uint8Array(digest)) };
};

const notSent = (): NotSentFailure => ({ ok: false, reason: "not_sent", resolution: "not_written" });

/**
 * Multipart POST `/api/portal/application-document-uploads`: поле `file`, Bearer, `Idempotency-Key` и `X-EVO-Upload-Intent`.
 * Сервер принимает только файл, названный `upload` внутри части (сама часть называется `file`), с тем же типом, размером и
 * SHA-256, что в запросе, поэтому выбранный файл сначала копируется байт в байт в свой подкаталог кэша под именем `upload`.
 * На 401 сессия обновляется один раз и уходит тот же запрос (тот же ключ и заголовок). Сбой связи после начала отправки -
 * `unavailable`: запись могла дойти, запрос остаётся. Сбой ДО начала отправки (нет сессии, не создался каталог, файл не
 * скопировался) - `not_sent`: в сеть ничего не ушло, запись о загрузке снимается и файл можно выбрать любой.
 */
export function createProgramUploader(baseUrl: string, getToken: () => Promise<string | null>, refreshToken?: () => Promise<string | null>): UploadFn {
  return async ({ intent, file, onProgress }) => {
    const header = encodeUploadHeader({ protocolVersion: 1, studentCaseId: intent.studentCaseId, applicationId: intent.applicationId, requirementsRevisionId: intent.requirementsRevisionId, requirementItemId: intent.requirementItemId, documentSlotId: intent.documentSlotId, file: intent.file });
    if (!header) return notSent();
    let stage: Directory | null = null;
    let started = false;
    try {
      const first = await getToken();
      if (!first) return notSent();
      stage = new Directory(Paths.cache, UPLOAD_STAGE_DIR, randomUUID());
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
      // С этой строки запрос мог дойти до сервера: любой сбой дальше - «исход неизвестен».
      started = true;
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
      return started ? { ok: false, reason: "unavailable", resolution: "retain" } : notSent();
    } finally {
      try {
        if (stage?.exists) stage.delete();
      } catch {
        // промежуточная копия уйдёт вместе с очисткой кэша
      }
    }
  };
}
