// Нативные операции экрана «Оплата» одним объектом: выбор и скачивание те же, что у «Документов»,
// плюс отправка чека. Тест подменяет объект целиком.
import { nativeDocumentsIo, type DocumentsIo } from "@/features/documents/io";
import * as native from "@/features/payments/native";
import type { ProofSend } from "@/features/payments/proof-upload";
import type { ReceiptSend } from "@/features/payments/receipt-upload";

export type PaymentsIo = DocumentsIo &
  Readonly<{
    createReceiptSend: (baseUrl: string, getToken: () => Promise<string | null>, refreshToken?: () => Promise<string | null>) => ReceiptSend;
    /** Чек к уже принятой оплате (#1458): файл и идентификатор оплаты. */
    createProofSend: (baseUrl: string, getToken: () => Promise<string | null>, refreshToken?: () => Promise<string | null>) => ProofSend;
    /** Текст в буфер обмена; `false` - система отказала. */
    copyText: (value: string) => Promise<boolean>;
  }>;

export const nativePaymentsIo: PaymentsIo = { ...nativeDocumentsIo, createReceiptSend: native.createReceiptSend, createProofSend: native.createProofSend, copyText: native.copyText };
