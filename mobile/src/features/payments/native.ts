// Нативная отправка чека: multipart POST /api/portal/payment-receipts с Bearer и Idempotency-Key.
// Логика запроса (проверки, ключи, обновление сессии) живёт в receipt-upload.ts и проверяется без устройства.
// API по документации Expo SDK 58: File.createUploadTask, UploadOptions.parameters (текстовые поля multipart).
import { randomUUID } from "expo-crypto";
import * as Clipboard from "expo-clipboard";
import { Directory, File, Paths, UploadType } from "expo-file-system";

import { PAYMENT_RECEIPT_UPLOAD_PATH } from "@web/lib/portal/payment-center";
import { writeCopiedText } from "@web/lib/portal/how-to-pay";

import { progressPercent, safeFileName } from "@/domain/documents-model";
import { UPLOAD_STAGE_DIR } from "@/features/documents/download-cache";
import { PAYMENT_PROOF_UPLOAD_PATH, type ProofSend } from "@/features/payments/proof-upload";
import { sendWithRefresh, type ReceiptSend } from "@/features/payments/receipt-upload";

/** Реквизиты в буфер обмена. Отказ системы - `false`, экран показывает «Не удалось скопировать». */
export function copyText(value: string): Promise<boolean> {
  return writeCopiedText(value, {
    writeText: async (text) => {
      if (!(await Clipboard.setStringAsync(text))) throw new Error("clipboard");
    },
  });
}

/** Чек к принятой оплате: тот же путь, что у `createReceiptSend`, другие поля (`payment_event_id`). */
export function createProofSend(baseUrl: string, getToken: () => Promise<string | null>, refreshToken?: () => Promise<string | null>): ProofSend {
  return async (attempt) => {
    const stage = new Directory(Paths.cache, UPLOAD_STAGE_DIR, randomUUID());
    try {
      stage.create({ intermediates: true });
      const staged = new File(stage, safeFileName(attempt.file.name, attempt.mimeType));
      new File(attempt.file.uri).copy(staged);
      const post = async (token: string) => {
        const task = staged.createUploadTask(`${baseUrl}${PAYMENT_PROOF_UPLOAD_PATH}`, {
          uploadType: UploadType.MULTIPART,
          fieldName: "file",
          mimeType: attempt.mimeType,
          parameters: { payment_event_id: attempt.paymentEventId },
          headers: { Authorization: `Bearer ${token}`, "Idempotency-Key": attempt.idempotencyKey, Accept: "application/json" },
          onProgress: ({ bytesSent, totalBytes }) => {
            const percent = progressPercent(bytesSent, totalBytes);
            if (percent !== null) attempt.onProgress(percent);
          },
          signal: attempt.signal,
        });
        const result = await task.uploadAsync();
        let body: unknown = null;
        try {
          body = JSON.parse(result.body);
        } catch {
          body = null;
        }
        return { status: result.status, body };
      };
      return await sendWithRefresh(post, getToken, refreshToken);
    } finally {
      try {
        if (stage.exists) stage.delete();
      } catch {
        // промежуточная копия уйдёт вместе с очисткой кэша
      }
    }
  };
}

/**
 * Файл сначала копируется в свой подкаталог кэша под безопасным именем (имя части multipart берётся из имени
 * файла), тип задаётся явно. Поля `amount`, `currency`, `paid_on` и `payment_obligation_id` (если есть) идут
 * текстовыми частями. На 401 сессия обновляется один раз, тот же запрос уходит с тем же Idempotency-Key.
 */
export function createReceiptSend(baseUrl: string, getToken: () => Promise<string | null>, refreshToken?: () => Promise<string | null>): ReceiptSend {
  return async (attempt) => {
    const stage = new Directory(Paths.cache, UPLOAD_STAGE_DIR, randomUUID());
    try {
      stage.create({ intermediates: true });
      const staged = new File(stage, safeFileName(attempt.file.name, attempt.mimeType));
      new File(attempt.file.uri).copy(staged);
      const parameters: Record<string, string> = { amount: attempt.fields.amount, currency: attempt.fields.currency, paid_on: attempt.fields.paidOn };
      if (attempt.fields.obligationId) parameters.payment_obligation_id = attempt.fields.obligationId;
      const post = async (token: string) => {
        const task = staged.createUploadTask(`${baseUrl}${PAYMENT_RECEIPT_UPLOAD_PATH}`, {
          uploadType: UploadType.MULTIPART,
          fieldName: "file",
          mimeType: attempt.mimeType,
          parameters,
          headers: { Authorization: `Bearer ${token}`, "Idempotency-Key": attempt.idempotencyKey, Accept: "application/json" },
          onProgress: ({ bytesSent, totalBytes }) => {
            const percent = progressPercent(bytesSent, totalBytes);
            if (percent !== null) attempt.onProgress(percent);
          },
          signal: attempt.signal,
        });
        const result = await task.uploadAsync();
        let body: unknown = null;
        try {
          body = JSON.parse(result.body);
        } catch {
          body = null;
        }
        return { status: result.status, body };
      };
      return await sendWithRefresh(post, getToken, refreshToken);
    } finally {
      try {
        if (stage.exists) stage.delete();
      } catch {
        // промежуточная копия уйдёт вместе с очисткой кэша
      }
    }
  };
}
