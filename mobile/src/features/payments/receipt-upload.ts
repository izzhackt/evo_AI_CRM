// Отправка чека студента как конечный автомат без React и без нативных модулей.
// Инварианты (маршрут POST /api/portal/payment-receipts, веб: PaymentsView.tsx):
//  1. `Idempotency-Key` создаётся на попытку и держится, пока исход неизвестен: обрыв сети, отмена и 5xx
//     повторяются с тем же ключом и теми же полями. Любой определённый ответ сервера (успех или 4xx)
//     освобождает ключ: следующая отправка идёт с новым.
//  2. Другой файл или другие поля - всегда новый ключ (иначе сервер увидит тот же ключ с иным телом).
//  3. Размер, тип, сумма, валюта и дата проверяются до отправки; текст ответа сервера в сообщение
//     не попадает, из него берётся только код ошибки по словарю общего модуля.
import {
  PAYMENT_RECEIPT_ERROR_KEYS,
  paymentReceiptErrorKey,
  receiptAmountToMinor,
  type PaymentReceiptErrorKey,
} from "@web/lib/portal/payment-center";

import { checkPickedFile, type PickedFile } from "@/domain/documents-model";
import type { DocumentMimeType } from "@/domain/portal-source";

export type ReceiptField = "amount" | "currency" | "date" | "file";

export type ReceiptInput = Readonly<{
  file: PickedFile | null;
  /** Как введено: «1 000,50» или «1000.5». */
  amount: string;
  /** Три латинские буквы; при выбранном платеже совпадает с валютой платежа. */
  currency: string;
  /** `YYYY-MM-DD` или `дд.мм.гггг`. */
  paidOn: string;
  /** Платёж; `null` - чек без платежа. */
  obligationId: string | null;
}>;

export type ReceiptState =
  | Readonly<{ status: "idle" }>
  | Readonly<{ status: "sending"; progress: number }>
  | Readonly<{ status: "success" }>
  | Readonly<{ status: "error"; error: PaymentReceiptErrorKey; field: ReceiptField | null; retryable: boolean }>;

export type ReceiptFields = Readonly<{
  /** Десятичная строка с двумя знаками: «100.50». */
  amount: string;
  currency: string;
  paidOn: string;
  obligationId: string | null;
}>;

export type ReceiptAttempt = Readonly<{
  file: PickedFile;
  mimeType: DocumentMimeType;
  fields: ReceiptFields;
  idempotencyKey: string;
  signal: AbortSignal;
  /** 0..100 */
  onProgress: (percent: number) => void;
}>;

export type ReceiptResponse = Readonly<{ status: number; body: unknown }>;
export type ReceiptSend = (attempt: ReceiptAttempt) => Promise<ReceiptResponse>;

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DOTTED = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/;
const BISHKEK_OFFSET_MS = 6 * 60 * 60 * 1000;

/** Сегодняшний день по Бишкеку (UTC+6, без перехода на летнее время). */
export function todayInBishkek(now: number = Date.now()): string {
  return new Date(now + BISHKEK_OFFSET_MS).toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` или `дд.мм.гггг` -> настоящий календарный день `YYYY-MM-DD`; иначе `null`. */
export function normalizeDay(input: string): string | null {
  const value = input.trim();
  const iso = DAY.exec(value);
  const dotted = DOTTED.exec(value);
  const parts = iso ? [iso[1], iso[2], iso[3]] : dotted ? [dotted[3], dotted[2]?.padStart(2, "0"), dotted[1]?.padStart(2, "0")] : null;
  if (!parts || parts.some((part) => part === undefined)) return null;
  const [year, month, day] = parts as [string, string, string];
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  const same = date.getUTCFullYear() === Number(year) && date.getUTCMonth() === Number(month) - 1 && date.getUTCDate() === Number(day);
  return same ? `${year}-${month}-${day}` : null;
}

/** Целые минорные единицы строкой -> «100.50». */
export function minorToDecimal(minor: string): string {
  const padded = minor.padStart(3, "0");
  return `${padded.slice(0, -2)}.${padded.slice(-2)}`;
}

export type ReceiptCheck =
  | Readonly<{ ok: true; mimeType: DocumentMimeType; fields: ReceiptFields; file: PickedFile }>
  | Readonly<{ ok: false; error: PaymentReceiptErrorKey; field: ReceiptField }>;

/** Проверка до отправки; сервер проверит всё то же ещё раз. */
export function checkReceiptInput(input: ReceiptInput, now: number = Date.now()): ReceiptCheck {
  const file = input.file;
  if (!file) return { ok: false, error: "receiptErrorInvalid", field: "file" };
  const checked = checkPickedFile(file);
  if (!checked.ok) return { ok: false, error: checked.reason === "type" ? "receiptErrorFileType" : "receiptErrorTooLarge", field: "file" };
  const minor = receiptAmountToMinor(input.amount);
  if (minor === null) return { ok: false, error: "receiptErrorInvalid", field: "amount" };
  const currency = input.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return { ok: false, error: "receiptErrorCurrency", field: "currency" };
  const paidOn = normalizeDay(input.paidOn);
  if (paidOn === null) return { ok: false, error: "receiptErrorInvalid", field: "date" };
  if (paidOn > todayInBishkek(now)) return { ok: false, error: "receiptErrorDate", field: "date" };
  return { ok: true, mimeType: checked.mimeType, file, fields: { amount: minorToDecimal(minor), currency, paidOn, obligationId: input.obligationId } };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Точная квитанция `{receipt_id, status: "pending"}`. */
export function parseReceiptAck(body: unknown): boolean {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return false;
  const row = body as Record<string, unknown>;
  return Object.keys(row).sort().join() === "receipt_id,status" && typeof row.receipt_id === "string" && UUID.test(row.receipt_id) && row.status === "pending";
}

const STATUS_FALLBACK: Readonly<Record<number, PaymentReceiptErrorKey>> = {
  401: "receiptErrorSession",
  403: "receiptErrorForbidden",
  409: "receiptErrorDuplicate",
  413: "receiptErrorTooLarge",
  415: "receiptErrorFileType",
  422: "receiptErrorInvalid",
  429: "receiptErrorTooMany",
};

/** Ответ с ошибкой -> ключ строки: сначала код сервера, затем статус. */
export function receiptFailureKey(response: ReceiptResponse): PaymentReceiptErrorKey {
  const code = typeof response.body === "object" && response.body !== null ? (response.body as { error?: unknown }).error : undefined;
  if (typeof code === "string" && Object.hasOwn(PAYMENT_RECEIPT_ERROR_KEYS, code)) return paymentReceiptErrorKey(code);
  return STATUS_FALLBACK[response.status] ?? "receiptErrorUnavailable";
}

/**
 * Один запрос с одним обновлением сессии: на 401 токен обновляется и тот же запрос (тот же ключ)
 * уходит повторно. Нативная отправка строится на этой функции.
 */
export async function sendWithRefresh(
  post: (token: string) => Promise<ReceiptResponse>,
  getToken: () => Promise<string | null>,
  refreshToken?: () => Promise<string | null>,
): Promise<ReceiptResponse> {
  const first = await getToken();
  if (!first) return { status: 401, body: null };
  let response = await post(first);
  if (response.status === 401 && refreshToken) {
    const renewed = await refreshToken();
    if (renewed) response = await post(renewed);
  }
  return response;
}

export class ReceiptUploadController {
  private state: ReceiptState = { status: "idle" };
  private key: string | null = null;
  private fingerprint: string | null = null;
  private abort: AbortController | null = null;
  private run = 0;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly send: ReceiptSend,
    private readonly newKey: () => string,
    private readonly onUploaded: () => void = () => undefined,
    private readonly now: () => number = Date.now,
  ) {}

  getState = (): ReceiptState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(next: ReceiptState) {
    this.state = next;
    for (const listener of [...this.listeners]) listener();
  }

  /** Ключ текущей неоконченной попытки (для тестов); `null`, когда исход известен. */
  currentKey(): string | null {
    return this.key;
  }

  busy(): boolean {
    return this.state.status === "sending";
  }

  /** Сбросить сообщение (форма снова редактируется); ключ неоконченной попытки сохраняется. */
  clearMessage(): void {
    if (this.busy() || this.state.status === "idle") return;
    this.set({ status: "idle" });
  }

  cancel(): void {
    this.abort?.abort();
  }

  /** «Отправить» и «Повторить»: проверка, ключ (старый, только если поля те же и исход был неизвестен), отправка. */
  submit(input: ReceiptInput): void {
    if (this.busy()) return;
    const check = checkReceiptInput(input, this.now());
    if (!check.ok) {
      this.set({ status: "error", error: check.error, field: check.field, retryable: false });
      return;
    }
    const fingerprint = JSON.stringify([check.file.uri, check.file.size, check.mimeType, check.fields]);
    if (this.key === null || this.fingerprint !== fingerprint) {
      this.key = this.newKey();
      this.fingerprint = fingerprint;
    }
    void this.start(check.file, check.mimeType, check.fields, this.key);
  }

  private release() {
    this.key = null;
    this.fingerprint = null;
  }

  private async start(file: PickedFile, mimeType: DocumentMimeType, fields: ReceiptFields, key: string): Promise<void> {
    const id = ++this.run;
    const abort = new AbortController();
    this.abort = abort;
    this.set({ status: "sending", progress: 0 });
    const onProgress = (percent: number) => {
      if (id === this.run && this.busy()) this.set({ status: "sending", progress: Math.max(0, Math.min(100, Math.round(percent))) });
    };
    let response: ReceiptResponse;
    try {
      response = await this.send({ file, mimeType, fields, idempotencyKey: key, signal: abort.signal, onProgress });
    } catch {
      if (id !== this.run) return;
      // Исход неизвестен: ключ остаётся, повтор шлёт тот же запрос.
      this.set({ status: "error", error: "receiptErrorUnavailable", field: null, retryable: true });
      return;
    }
    if (id !== this.run) return;
    if (response.status === 200 || response.status === 201) {
      if (!parseReceiptAck(response.body)) {
        // Чек мог сохраниться: тот же ключ вернёт ту же квитанцию.
        this.set({ status: "error", error: "receiptErrorUnavailable", field: null, retryable: true });
        return;
      }
      this.release();
      this.set({ status: "success" });
      this.onUploaded();
      return;
    }
    if (response.status >= 500) {
      this.set({ status: "error", error: receiptFailureKey(response), field: null, retryable: true });
      return;
    }
    // Определённый отказ: этот ключ отработан, следующая отправка получит новый.
    this.release();
    this.set({ status: "error", error: receiptFailureKey(response), field: null, retryable: response.status === 401 || response.status === 429 });
  }
}
