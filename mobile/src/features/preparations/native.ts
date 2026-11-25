// Нативные части документов программы: отпечаток файла и отправка multipart с Bearer. Правила протокола живут в
// `upload-protocol.ts` и проверяются без устройства; здесь только чтение байтов, копия файла и вызов загрузки.
// API по версионной документации Expo SDK 58: expo-file-system (File, Directory, Paths, UploadType) и expo-crypto (digest).
import * as Crypto from "expo-crypto";
import { Directory, File, Paths, UploadType, type UploadResult, type UploadTask } from "expo-file-system";
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
 * Сколько отправка может стоять, не прибавляя ни одного байта, прежде чем её считают оборванной и останавливают. Идущая
 * загрузка тишиной не бывает: большой файл на медленной связи двигает счётчик всё время и не обрывается, сколько бы он ни шёл.
 * Срок считается и пока идёт ожидание ответа сервера (после последнего байта). iPhone в обычной сессии обрывает такую тишину
 * сам через 60 с (`timeoutIntervalForRequest`), Android тоже (OkHttp, 60 с); этот срок страхует приложение, если нативный слой
 * промолчит, и его можно проверить без устройства.
 */
export const UPLOAD_INACTIVITY_MS = 90_000;

/**
 * Multipart POST `/api/portal/application-document-uploads`: поле `file`, Bearer, `Idempotency-Key` и `X-EVO-Upload-Intent`.
 * Сервер принимает только файл, названный `upload` внутри части (сама часть называется `file`), с тем же типом, размером и
 * SHA-256, что в запросе, поэтому выбранный файл сначала копируется байт в байт в свой подкаталог кэша под именем `upload`.
 * На 401 сессия обновляется один раз и уходит тот же запрос (тот же ключ и заголовок). Сбой связи после начала отправки -
 * `unavailable`: запись могла дойти, запрос остаётся. Сбой ДО начала отправки (нет сессии, не создался каталог, файл не
 * скопировался) - `not_sent`: в сеть ничего не ушло, запись о загрузке снимается и файл можно выбрать любой.
 *
 * Отправка идёт в обычной (не фоновой) сессии iOS: фоновая по умолчанию ждёт связи сколько угодно, и при остановленном портале
 * кнопка стояла «Загружаем…» минутами. В обычной сессии отказ в соединении приходит сразу, а тишина дольше
 * `UPLOAD_INACTIVITY_MS` отменяет задачу. Отмена студента (`signal`) и остановка по тишине подчиняются тому же правилу: до
 * начала отправки это `not_sent`, после - `unavailable` (байты могли дойти, запись остаётся и проверяется тем же запросом).
 */
export function createProgramUploader(baseUrl: string, getToken: () => Promise<string | null>, refreshToken?: () => Promise<string | null>): UploadFn {
  return async ({ intent, file, onProgress, signal }) => {
    const header = encodeUploadHeader({ protocolVersion: 1, studentCaseId: intent.studentCaseId, applicationId: intent.applicationId, requirementsRevisionId: intent.requirementsRevisionId, requirementItemId: intent.requirementItemId, documentSlotId: intent.documentSlotId, file: intent.file });
    if (!header || signal?.aborted) return notSent();
    let stage: Directory | null = null;
    let started = false;
    try {
      const first = await getToken();
      if (!first) return notSent();
      // Студент остановил загрузку, пока брался токен: в сеть ничего не ушло. Дальше до начала отправки ожиданий нет.
      if (signal?.aborted) return notSent();
      stage = new Directory(Paths.cache, UPLOAD_STAGE_DIR, randomUUID());
      stage.create({ intermediates: true });
      const staged = new File(stage, UPLOAD_TRANSPORT_FILENAME);
      new File(file.uri).copy(staged);
      const post = async (token: string): Promise<UploadResult> => {
        let task: UploadTask | null = null;
        let silence: ReturnType<typeof setTimeout> | null = null;
        let sentBytes = 0;
        // Таймер тишины: каждый прирост отправленных байтов начинает отсчёт заново; по истечении задача отменяется, а её
        // обещание отклоняется (ниже это «исход неизвестен»). Повторы одного и того же числа байтов ходом не считаются.
        const arm = () => {
          if (silence !== null) clearTimeout(silence);
          silence = setTimeout(() => {
            try {
              task?.cancel();
            } catch {
              // отмена необязательна: следующий сбой всё равно придёт из задачи
            }
          }, UPLOAD_INACTIVITY_MS);
        };
        try {
          task = staged.createUploadTask(`${baseUrl}${UPLOAD_PATH}`, {
            uploadType: UploadType.MULTIPART,
            fieldName: "file",
            mimeType: intent.file.declaredMimeType,
            headers: { Authorization: `Bearer ${token}`, "Idempotency-Key": intent.requestId, [UPLOAD_INTENT_HEADER]: header, Accept: "application/json" },
            // Обычная сессия iOS: отказ в соединении приходит сразу. Фоновая (по умолчанию) ждёт связи и не отвечает минутами.
            sessionType: "foreground",
            signal,
            onProgress: ({ bytesSent, totalBytes }) => {
              if (bytesSent > sentBytes) {
                sentBytes = bytesSent;
                arm();
              }
              const percent = progressPercent(bytesSent, totalBytes);
              if (percent !== null) onProgress?.(percent);
            },
          });
          arm();
          return await task.uploadAsync();
        } finally {
          if (silence !== null) clearTimeout(silence);
        }
      };
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
