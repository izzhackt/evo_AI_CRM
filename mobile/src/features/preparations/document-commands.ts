// Команды над документом программы: «сохранить файл» (загрузка), «отправить на проверку» и «загрузить и отправить»
// одним нажатием. Порт `application-documents-commands.ts` веба на AsyncStorage и файлы устройства.
// Каждая команда берёт замок цели, записывает свой запрос ДО сетевого вызова и снимает его только после подтверждённой
// квитанции или точного ответа «не записано». Поэтому при любом обрыве остаётся либо сохранённый файл, либо запрос, который
// восстановление повторяет с тем же `requestId`. Замки загрузки и отправки берутся по очереди, не вложенно.
import type {
  ApplicationDocumentFailure,
  ApplicationDocumentItemTarget,
  ApplicationDocumentSelection,
  ApplicationDocumentSubmitIntent,
  ApplicationDocumentSubmitResult,
  ApplicationDocumentUploadIntent,
  ApplicationDocumentUploadReceipt,
  ApplicationDocumentUploadResult,
} from "@web/lib/portal/application-documents";
import { randomUUID } from "expo-crypto";

import type { PickedFile } from "@/domain/documents-model";
import { documentsPending, isSubmitIntent, isUploadIntent } from "@/features/preparations/documents-pending";
import type { PendingScope, PendingStorage } from "@/features/preparations/pending-store";
import { freezeUploadIntent, sameUploadIntent, type Fingerprinter } from "@/features/preparations/upload-protocol";

type Resolution = "retain" | "not_written";

/** Сбой ДО отправки (нет сессии, файл не скопировался): в сеть ничего не ушло, запись о загрузке можно снять. */
export type NotSentFailure = Readonly<{ ok: false; reason: "not_sent"; resolution: "not_written" }>;
export type UploadFn = (input: Readonly<{ intent: ApplicationDocumentUploadIntent; file: PickedFile; onProgress?: (percent: number) => void }>) => Promise<ApplicationDocumentUploadResult | NotSentFailure>;
export type SubmitFn = (intent: ApplicationDocumentSubmitIntent) => Promise<ApplicationDocumentSubmitResult>;

export type CommandEnv = Readonly<{
  /** Хранилище запросов (в тестах подменяется). */
  storage?: PendingStorage;
  newRequestId?: () => string;
}>;

export type UploadOutcome =
  | Readonly<{ status: "uploaded"; receipt: ApplicationDocumentUploadReceipt; cleared: boolean }>
  /** Файл не годится (тип, пустой, больше 25 МБ). */
  | Readonly<{ status: "invalid_file" }>
  /** Файл не прочитался: запрос не создан и не записан, тот же файл можно выбрать ещё раз. */
  | Readonly<{ status: "unreadable" }>
  | Readonly<{ status: "wrong_file" }>
  | Readonly<{ status: "rejected"; reason: ApplicationDocumentFailure | "not_sent"; resolution: Resolution }>
  | Readonly<{ status: "locked"; reason: "busy" | "storage_unavailable" }>;

/** Загрузка: заморозить запрос по файлу, записать, отправить, снять после подтверждённого исхода. */
export async function runUpload(input: Readonly<{
  scope: PendingScope;
  target: ApplicationDocumentItemTarget;
  file: PickedFile;
  fingerprint: Fingerprinter;
  upload: UploadFn;
  onProgress?: (percent: number) => void;
  env?: CommandEnv;
}>): Promise<UploadOutcome> {
  const { scope, target, file, env } = input;
  const itemId = target.requirementItemId;
  const locked = await documentsPending.withLock(
    scope,
    "upload",
    itemId,
    async (): Promise<UploadOutcome> => {
      const saved = await documentsPending.read(scope, "upload", itemId, env?.storage);
      if (saved.blocked) throw new Error("storage_unavailable");
      const old = isUploadIntent(saved.intent) ? saved.intent : null;
      // Повтор идёт по своей прежней ревизии и цели, даже если требования с тех пор изменились.
      const originalTarget = old
        ? { studentCaseId: old.studentCaseId, applicationId: old.applicationId, requirementsRevisionId: old.requirementsRevisionId, requirementItemId: old.requirementItemId, documentSlotId: old.documentSlotId }
        : target;
      const frozen = await freezeUploadIntent({ target: originalTarget, file, requestId: old?.requestId ?? (env?.newRequestId ?? randomUUID)(), fingerprint: input.fingerprint });
      if (frozen.status === "invalid") return { status: "invalid_file" };
      if (frozen.status === "unreadable") return { status: "unreadable" };
      const next = frozen.intent;
      if (old && !sameUploadIntent(old, next)) return { status: "wrong_file" };
      const intent = old ?? next;
      await documentsPending.persist(scope, "upload", itemId, intent, env?.storage);
      const result = await input.upload({ intent, file, onProgress: input.onProgress });
      let cleared = true;
      if (result.ok || result.resolution === "not_written") {
        try {
          await documentsPending.clear(scope, "upload", itemId, intent, env?.storage);
        } catch {
          cleared = false;
        }
      }
      return result.ok ? { status: "uploaded", receipt: result.receipt, cleared } : { status: "rejected", reason: result.reason, resolution: result.resolution };
    },
    env?.storage,
  );
  return locked.acquired ? locked.value : { status: "locked", reason: locked.reason };
}

export type SubmitOutcome =
  | Readonly<{ status: "sent"; cleared: boolean }>
  | Readonly<{ status: "rejected"; reason: ApplicationDocumentFailure; resolution: Resolution }>
  /** Ничего не выбрано и запроса нет: команда не запускалась. */
  | Readonly<{ status: "idle" }>
  /** Запрос уже есть, а вызывающий попросил его не повторять. */
  | Readonly<{ status: "retained" }>
  /** Команда не стартовала: занято или хранилище не отвечает. */
  | Readonly<{ status: "locked"; reason: "busy" | "storage_unavailable" }>
  /** Запрос записан на телефоне, а исход не подтверждён. */
  | Readonly<{ status: "unknown" }>;

/** Цель отправки: у запроса отправки нет идентификатора документа (слота), только требование и ревизия. */
export type SubmitTarget = Omit<ApplicationDocumentItemTarget, "documentSlotId">;

/** Отправка выбранной версии на проверку; прежний неоконченный запрос повторяется как был записан. */
export async function runSubmit(input: Readonly<{
  scope: PendingScope;
  target: SubmitTarget;
  selection: ApplicationDocumentSelection | null;
  previousSubmissionId: string | null;
  submit: SubmitFn;
  /** `resend` повторяет сохранённый запрос («Проверить результат»); `stop` оставляет его этой кнопке. */
  whenRetained: "resend" | "stop";
  env?: CommandEnv;
}>): Promise<SubmitOutcome> {
  const { scope, target, selection, env } = input;
  const itemId = target.requirementItemId;
  let persisted = false;
  const locked = await documentsPending.withLock(
    scope,
    "submit",
    itemId,
    async (): Promise<SubmitOutcome> => {
      const saved = await documentsPending.read(scope, "submit", itemId, env?.storage);
      if (saved.blocked) throw new Error("storage_unavailable");
      const old = isSubmitIntent(saved.intent) ? saved.intent : null;
      if (old && input.whenRetained === "stop") return { status: "retained" };
      if (!old && !selection) return { status: "idle" };
      const intent: ApplicationDocumentSubmitIntent = old ?? {
        studentCaseId: target.studentCaseId,
        applicationId: target.applicationId,
        requirementsRevisionId: target.requirementsRevisionId,
        requirementItemId: itemId,
        requestId: (env?.newRequestId ?? randomUUID)(),
        selection: selection!,
        expectedPreviousSubmissionId: input.previousSubmissionId,
      };
      await documentsPending.persist(scope, "submit", itemId, intent, env?.storage);
      persisted = true;
      const result = await input.submit(intent);
      let cleared = true;
      if (result.ok || result.resolution === "not_written") {
        try {
          await documentsPending.clear(scope, "submit", itemId, intent, env?.storage);
        } catch {
          cleared = false;
        }
      }
      return result.ok ? { status: "sent", cleared } : { status: "rejected", reason: result.reason, resolution: result.resolution };
    },
    env?.storage,
  );
  if (locked.acquired) return locked.value;
  // Исключение внутри команды замок сообщает как «хранилище недоступно»; если запрос уже записан, исход неизвестен.
  return persisted ? { status: "unknown" } : { status: "locked", reason: locked.reason };
}

export type UploadAndSubmitOutcome =
  | Readonly<{ stage: "upload"; upload: Exclude<UploadOutcome, { status: "uploaded" }> }>
  | Readonly<{
      stage: "done";
      upload: Extract<UploadOutcome, { status: "uploaded" }>;
      /** `skipped`: только загрузка (студенту нельзя отправлять) или сохранённый файл относится к прежним требованиям. */
      submit: SubmitOutcome | Readonly<{ status: "skipped"; why: "upload_only" | "target_changed" }>;
    }>;

/**
 * Одно нажатие студента: загрузить и, получив подтверждённую квитанцию, отправить на проверку именно эту сохранённую
 * версию. Без квитанции ничего не отправляется, а прежний неоконченный запрос отправки не повторяется вместо нового файла.
 */
export async function runUploadAndSubmit(input: Readonly<{
  scope: PendingScope;
  target: ApplicationDocumentItemTarget;
  file: PickedFile;
  fingerprint: Fingerprinter;
  upload: UploadFn;
  /** `null`: только загрузка. */
  sendAfterUpload: Readonly<{ previousSubmissionId: string | null; submit: SubmitFn }> | null;
  env?: CommandEnv;
  onStage?: (stage: "upload" | "submit") => void;
  onProgress?: (percent: number) => void;
}>): Promise<UploadAndSubmitOutcome> {
  const { scope, target } = input;
  const stage = (value: "upload" | "submit") => {
    try {
      input.onStage?.(value);
    } catch {
      // Показ этапа исход не меняет.
    }
  };
  stage("upload");
  const upload = await runUpload({ scope, target, file: input.file, fingerprint: input.fingerprint, upload: input.upload, onProgress: input.onProgress, env: input.env });
  if (upload.status !== "uploaded") return { stage: "upload", upload };
  const send = input.sendAfterUpload;
  if (!send) return { stage: "done", upload, submit: { status: "skipped", why: "upload_only" } };
  const receipt = upload.receipt;
  // Прежняя неоконченная загрузка сохранилась в свою прежнюю ревизию: отправлять её без глаз студента нельзя.
  if (
    receipt.studentCaseId !== target.studentCaseId || receipt.applicationId !== target.applicationId ||
    receipt.requirementsRevisionId !== target.requirementsRevisionId || receipt.requirementItemId !== target.requirementItemId ||
    receipt.documentSlotId !== target.documentSlotId
  )
    return { stage: "done", upload, submit: { status: "skipped", why: "target_changed" } };
  stage("submit");
  const submit = await runSubmit({
    scope,
    target,
    previousSubmissionId: send.previousSubmissionId,
    submit: send.submit,
    whenRetained: "stop",
    selection: { kind: "program_upload", uploadContextId: receipt.uploadContextId, documentVersionId: receipt.documentVersionId },
    env: input.env,
  });
  return { stage: "done", upload, submit };
}
