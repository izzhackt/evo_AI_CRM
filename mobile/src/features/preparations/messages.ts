// Что студент читает после действия с документом программы. Порт `documentActionMessage`, `uploadFailureMessage` и
// `sendFailureMessage` из `ProgramDocumentControls.tsx` веба: чистые функции от итога команды и словаря.
import { formatPortalString } from "@web/lib/portal/i18n";

import type { SubmitOutcome, UploadAndSubmitOutcome, UploadOutcome } from "@/features/preparations/document-commands";
import type { DocumentStrings } from "@/features/preparations/document-strings";

/** Причина отказа -> строка (веб: `documentActionMessage`). */
export function documentActionMessage(reason: string, strings: DocumentStrings): string {
  if (reason === "forbidden") return strings.forbidden;
  if (["stale_context", "request_conflict", "invalid", "case_ineligible", "application_ineligible"].includes(reason)) return strings.changed;
  if (["file_too_large", "unsupported_type"].includes(reason)) return strings.fileInvalid;
  // `not_sent`: сбой до отправки (нет сессии, файл не скопировался): в сеть ничего не ушло, файл можно выбрать снова.
  if (reason === "malware_detected" || reason === "not_sent") return strings.uploadFailed;
  if (reason === "storage_unavailable") return strings.storageUnavailable;
  return strings.unavailable;
}

type UploadFailure = Extract<UploadAndSubmitOutcome, { stage: "upload" }>["upload"];

/** Тексты приложения, которых нет в словаре веба. */
export type LocalMessages = Readonly<{ unreadable: string }>;

/** Загрузка не состоялась. */
export function uploadFailureMessage(outcome: UploadFailure | Exclude<UploadOutcome, { status: "uploaded" }>, strings: DocumentStrings, local: LocalMessages): string {
  switch (outcome.status) {
    case "invalid_file":
      return strings.fileInvalid;
    // Файл исчез или не открывается: это не «неверный формат», и повторный выбор может помочь.
    case "unreadable":
      return local.unreadable;
    case "wrong_file":
      return strings.wrongFile;
    case "rejected":
      return documentActionMessage(outcome.reason, strings);
    case "locked":
      return outcome.reason === "busy" ? strings.pending : strings.storageUnavailable;
  }
}

/**
 * Итог загрузки, которую остановил студент («Отменить загрузку»): либо до начала отправки (`not_sent`), либо после неё
 * («исход неизвестен», запись остаётся). Ответ сервера (отказ с причиной) и сбой самого файла сюда не относятся.
 */
export function uploadWasStopped(outcome: UploadFailure | Exclude<UploadOutcome, { status: "uploaded" }>): boolean {
  return outcome.status === "rejected" && (outcome.reason === "not_sent" || (outcome.reason === "unavailable" && outcome.resolution === "retain"));
}

type SendStep = Extract<UploadAndSubmitOutcome, { stage: "done" }>["submit"];

/** Файл сохранён, а отправка не прошла: что сказать студенту (`null`: всё в порядке или говорить нечего). */
export function sendFailureMessage(outcome: SendStep, strings: DocumentStrings): string | null {
  const notSent = (reason: string) => formatPortalString(strings.savedNotSent, { reason });
  switch (outcome.status) {
    // Исход неизвестен: запрос остался на телефоне, а кнопка отправки покажет «Проверить результат».
    case "unknown":
      return strings.unavailable;
    case "rejected":
      return outcome.reason === "unavailable" && outcome.resolution === "retain" ? strings.unavailable : notSent(documentActionMessage(outcome.reason, strings));
    // Отправка не стартовала: файл сохранён, а документ сейчас отправляется или хранилище не отвечает.
    case "locked":
      return outcome.reason === "busy" ? strings.savedSendBusy : notSent(strings.storageUnavailable);
    default:
      return null;
  }
}

export type { SubmitOutcome };
