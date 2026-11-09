// Загрузка файла в слот чек-листа как конечный автомат без React и без нативных модулей.
// Инварианты (веб: PortalDocumentControls.tsx, iPhone 1.1 §8):
//  1. Ключ `Idempotency-Key` создаётся ОДИН раз на выбранный файл и замораживается;
//     «Повторить» и «Продолжить» после обрыва или отмены шлют тот же ключ.
//  2. Новый ключ только при выборе другого файла (или после успеха).
//  3. Размер и тип проверяются до отправки; ответ сервера в сообщение не попадает,
//     из него берётся только код статуса и точная квитанция.
import { checkPickedFile, type PickedFile } from "@/domain/documents-model";
import type { DocumentMimeType } from "@/domain/portal-source";

export type UploadErrorKey =
  | "errorBadFile"
  | "errorForbidden"
  | "errorConflict"
  | "errorTooLarge"
  | "errorScan"
  | "errorTooMany"
  | "errorUnavailable"
  | "errorNetwork"
  | "errorReceipt"
  | "docs.errorType"
  | "docs.errorEmpty"
  | "docs.errorSession";

export type UploadState =
  | Readonly<{ status: "idle" }>
  | Readonly<{ status: "uploading"; progress: number; fileName: string }>
  | Readonly<{ status: "confirming"; fileName: string }>
  | Readonly<{ status: "success"; fileName: string }>
  | Readonly<{ status: "cancelled"; fileName: string }>
  | Readonly<{ status: "error"; error: UploadErrorKey; fileName: string | null; retryable: boolean }>;

export type UploadAttempt = Readonly<{
  slotId: string;
  file: PickedFile;
  mimeType: DocumentMimeType;
  idempotencyKey: string;
  signal: AbortSignal;
  /** 0..100 */
  onProgress: (percent: number) => void;
}>;

export type UploadResponse = Readonly<{ status: number; body: unknown }>;
export type UploadSend = (attempt: UploadAttempt) => Promise<UploadResponse>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Точная квитанция `201 {document:{...}}` (веб: exactUploadReceipt). */
export function parseUploadReceipt(body: unknown, slotId: string): boolean {
  const exact = (value: unknown, keys: readonly string[]): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).sort().join() === [...keys].sort().join();
  if (!exact(body, ["document"])) return false;
  const doc = body.document;
  return (
    exact(doc, ["documentSlotId", "documentVersionId", "versionNumber", "originalFilename", "declaredMimeType", "byteSize"]) &&
    doc.documentSlotId === slotId &&
    typeof doc.documentVersionId === "string" &&
    UUID.test(doc.documentVersionId) &&
    doc.documentVersionId !== "00000000-0000-0000-0000-000000000000" &&
    Number.isSafeInteger(doc.versionNumber) &&
    Number(doc.versionNumber) >= 1 &&
    typeof doc.originalFilename === "string" &&
    doc.originalFilename.length >= 1 &&
    doc.originalFilename.length <= 255 &&
    ["application/pdf", "image/jpeg", "image/png"].includes(String(doc.declaredMimeType)) &&
    Number.isSafeInteger(doc.byteSize) &&
    Number(doc.byteSize) >= 1 &&
    Number(doc.byteSize) <= 25 * 1024 * 1024
  );
}

/** Статус ответа в ключ строки (веб: uploadFailureMessage) и можно ли повторить без нового файла. */
export function failureOf(status: number): Readonly<{ error: UploadErrorKey; retryable: boolean }> {
  if (status === 400 || status === 415) return { error: "errorBadFile", retryable: false };
  if (status === 401) return { error: "docs.errorSession", retryable: true };
  if (status === 403) return { error: "errorForbidden", retryable: false };
  if (status === 409) return { error: "errorConflict", retryable: true };
  if (status === 413) return { error: "errorTooLarge", retryable: false };
  if (status === 422) return { error: "errorScan", retryable: false };
  if (status === 429) return { error: "errorTooMany", retryable: true };
  return { error: "errorUnavailable", retryable: true };
}

export class UploadController {
  private state: UploadState = { status: "idle" };
  private file: PickedFile | null = null;
  private mimeType: DocumentMimeType | null = null;
  private key: string | null = null;
  private abort: AbortController | null = null;
  private run = 0;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly slotId: string,
    private readonly send: UploadSend,
    private readonly newKey: () => string,
    private readonly onUploaded: () => void = () => undefined,
  ) {}

  getState = (): UploadState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(next: UploadState) {
    this.state = next;
    for (const listener of [...this.listeners]) listener();
  }

  private busy(): boolean {
    return this.state.status === "uploading" || this.state.status === "confirming";
  }

  /** Ключ текущей попытки (для тестов и журнала); null, когда файла нет. */
  currentKey(): string | null {
    return this.key;
  }

  /** Выбран файл: проверка, новый ключ, отправка. Во время загрузки игнорируется. */
  select(file: PickedFile): void {
    if (this.busy()) return;
    const check = checkPickedFile(file);
    this.file = null;
    this.mimeType = null;
    this.key = null;
    if (!check.ok) {
      this.set({ status: "error", error: check.reason === "size" ? "errorTooLarge" : check.reason === "empty" ? "docs.errorEmpty" : "docs.errorType", fileName: file.name, retryable: false });
      return;
    }
    this.file = file;
    this.mimeType = check.mimeType;
    this.key = this.newKey();
    void this.start();
  }

  /** «Повторить» / «Продолжить»: тот же файл и тот же ключ. */
  retry(): void {
    if (this.busy() || !this.file || !this.key) return;
    if (this.state.status === "error" && !this.state.retryable) return;
    void this.start();
  }

  cancel(): void {
    if (!this.busy() || !this.abort) return;
    this.abort.abort();
  }

  reset(): void {
    if (this.busy()) return;
    this.file = null;
    this.mimeType = null;
    this.key = null;
    this.set({ status: "idle" });
  }

  private async start(): Promise<void> {
    const file = this.file;
    const mimeType = this.mimeType;
    const key = this.key;
    if (!file || !mimeType || !key) return;
    const id = ++this.run;
    const abort = new AbortController();
    this.abort = abort;
    this.set({ status: "uploading", progress: 0, fileName: file.name });
    const onProgress = (percent: number) => {
      if (id !== this.run || !this.busy()) return;
      this.set(percent >= 100 ? { status: "confirming", fileName: file.name } : { status: "uploading", progress: Math.max(0, Math.round(percent)), fileName: file.name });
    };
    let response: UploadResponse;
    try {
      response = await this.send({ slotId: this.slotId, file, mimeType, idempotencyKey: key, signal: abort.signal, onProgress });
    } catch {
      if (id !== this.run) return;
      // Отмена: ключ остаётся, «Продолжить» шлёт тот же запрос.
      this.set(abort.signal.aborted ? { status: "cancelled", fileName: file.name } : { status: "error", error: "errorNetwork", fileName: file.name, retryable: true });
      return;
    }
    if (id !== this.run) return;
    if (abort.signal.aborted) {
      this.set({ status: "cancelled", fileName: file.name });
      return;
    }
    if (response.status !== 201) {
      const failure = failureOf(response.status);
      this.set({ status: "error", error: failure.error, fileName: file.name, retryable: failure.retryable });
      return;
    }
    if (!parseUploadReceipt(response.body, this.slotId)) {
      // Файл мог сохраниться: повтор с тем же ключом вернёт ту же квитанцию.
      this.set({ status: "error", error: "errorReceipt", fileName: file.name, retryable: true });
      return;
    }
    this.file = null;
    this.mimeType = null;
    this.key = null;
    this.set({ status: "success", fileName: file.name });
    this.onUploaded();
  }
}
