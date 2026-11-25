// «Чек к уже принятой оплате» (веб: PaymentReceiptForm.tsx ProofSlot, миграция 360, #1458):
// multipart POST /api/portal/payment-proofs с полями `file` и `payment_event_id`. Только доказательство:
// деньги и статус оплаты не меняются. Конечный автомат без React и без нативных модулей.
// Инварианты те же, что у чека (receipt-upload.ts): один Idempotency-Key на попытку, пока исход неизвестен;
// любой определённый ответ (успех или 4xx) освобождает ключ; текст ответа сервера в сообщение не попадает.
// «Файл уже есть» (409 proof_exists) - не ошибка, а повод обновить строку.
import { PAYMENT_PROOF_UPLOAD_PATH, parsePaymentProofResult, type PaymentProofResult } from "@web/lib/portal/payment-proof";
import type { PaymentReceiptErrorKey } from "@web/lib/portal/payment-center";

import { checkPickedFile, type PickedFile } from "@/domain/documents-model";
import type { DocumentMimeType } from "@/domain/portal-source";
import { fileCheckErrorKey, receiptFailureKey, sendWithRefresh, type ReceiptResponse } from "@/features/payments/receipt-upload";

export { PAYMENT_PROOF_UPLOAD_PATH };

export type ProofState =
  | Readonly<{ status: "idle" }>
  | Readonly<{ status: "sending"; progress: number }>
  | Readonly<{ status: "success"; result: PaymentProofResult | null }>
  | Readonly<{ status: "error"; error: PaymentReceiptErrorKey; retryable: boolean }>;

export type ProofAttempt = Readonly<{
  file: PickedFile;
  mimeType: DocumentMimeType;
  paymentEventId: string;
  idempotencyKey: string;
  signal: AbortSignal;
  onProgress: (percent: number) => void;
}>;

export type ProofSend = (attempt: ProofAttempt) => Promise<ReceiptResponse>;
export { sendWithRefresh };

export class ProofUploadController {
  private state: ProofState = { status: "idle" };
  private key: string | null = null;
  private fingerprint: string | null = null;
  private abort: AbortController | null = null;
  private run = 0;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly send: ProofSend,
    private readonly newKey: () => string,
    private readonly onUploaded: () => void = () => undefined,
  ) {}

  getState = (): ProofState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(next: ProofState) {
    this.state = next;
    for (const listener of [...this.listeners]) listener();
  }

  currentKey(): string | null {
    return this.key;
  }

  busy(): boolean {
    return this.state.status === "sending";
  }

  clearMessage(): void {
    if (this.busy() || this.state.status === "idle") return;
    this.set({ status: "idle" });
  }

  /**
   * Оборвать идущую отправку по решению студента (кнопки «Отменить отправку» пока нет, ничто это не вызывает). Закрытие формы, слота
   * или экрана отправку НЕ обрывает: сайт её тоже не обрывает, а оборванный чек пропадал бы молча (ревью #1560, M1).
   */
  cancel(): void {
    this.abort?.abort();
  }

  submit(paymentEventId: string, file: PickedFile | null): void {
    if (this.busy()) return;
    if (!file) {
      this.set({ status: "error", error: "receiptErrorInvalid", retryable: false });
      return;
    }
    const checked = checkPickedFile(file);
    if (!checked.ok) {
      this.set({ status: "error", error: fileCheckErrorKey(checked.reason), retryable: false });
      return;
    }
    const fingerprint = JSON.stringify([paymentEventId, file.uri, file.size, checked.mimeType]);
    if (this.key === null || this.fingerprint !== fingerprint) {
      this.key = this.newKey();
      this.fingerprint = fingerprint;
    }
    void this.start(file, checked.mimeType, paymentEventId, this.key);
  }

  private release() {
    this.key = null;
    this.fingerprint = null;
  }

  private async start(file: PickedFile, mimeType: DocumentMimeType, paymentEventId: string, key: string): Promise<void> {
    const id = ++this.run;
    const abort = new AbortController();
    this.abort = abort;
    this.set({ status: "sending", progress: 0 });
    const onProgress = (percent: number) => {
      if (id === this.run && this.busy()) this.set({ status: "sending", progress: Math.max(0, Math.min(100, Math.round(percent))) });
    };
    let response: ReceiptResponse;
    try {
      response = await this.send({ file, mimeType, paymentEventId, idempotencyKey: key, signal: abort.signal, onProgress });
    } catch {
      if (id !== this.run) return;
      this.set({ status: "error", error: "receiptErrorUnavailable", retryable: true });
      return;
    }
    if (id !== this.run) return;
    if (response.status === 200 || response.status === 201) {
      this.release();
      // Ответ не той формы: файл сохранён, ссылку подтянет обновление данных.
      this.set({ status: "success", result: parsePaymentProofResult(response.body) });
      this.onUploaded();
      return;
    }
    const code = typeof response.body === "object" && response.body !== null ? (response.body as { error?: unknown }).error : undefined;
    if (response.status === 409 && code === "proof_exists") {
      this.release();
      this.set({ status: "idle" });
      this.onUploaded();
      return;
    }
    if (response.status >= 500) {
      this.set({ status: "error", error: receiptFailureKey(response), retryable: true });
      return;
    }
    this.release();
    this.set({ status: "error", error: receiptFailureKey(response), retryable: response.status === 401 || response.status === 429 });
  }
}
