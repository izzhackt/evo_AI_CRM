// Нативные операции экрана «Оплата» одним объектом: выбор и скачивание те же, что у «Документов»,
// плюс отправка чека. Тест подменяет объект целиком.
import { nativeDocumentsIo, type DocumentsIo } from "@/features/documents/io";
import * as native from "@/features/payments/native";
import type { ReceiptSend } from "@/features/payments/receipt-upload";

export type PaymentsIo = DocumentsIo &
  Readonly<{
    createReceiptSend: (baseUrl: string, getToken: () => Promise<string | null>, refreshToken?: () => Promise<string | null>) => ReceiptSend;
  }>;

export const nativePaymentsIo: PaymentsIo = { ...nativeDocumentsIo, createReceiptSend: native.createReceiptSend };
