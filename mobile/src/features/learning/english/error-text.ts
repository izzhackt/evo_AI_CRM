// Текст ошибки записи урока и повторения словами сайта: четыре кода веба (`LearningActionError`) - конфликт, не принято, доступ
// закрыт, нет подтверждения. Остальные отказы сервера (срок вышел, задание уже отвечено) читаются как конфликт или «не принято».
import type { CscaFailure } from "@/features/learning/csca/api";
import type { PortalStrings } from "@/i18n";

export function englishErrorText(e: PortalStrings<"english">, code: CscaFailure): string {
  switch (code) {
    case "conflict":
    case "already_answered":
      return e.errorConflict;
    case "denied":
      return e.errorDenied;
    case "unavailable":
      return e.errorUnavailable;
    default:
      return e.errorInvalid;
  }
}
