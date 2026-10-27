import type { BoardServerPosition } from "@/components/v3/board/board-undo";
import type { MoveCasePipelineActionStatus } from "@/lib/platform-admissions-pipeline-actions";
import type { AdmissionsPipelineRow, AdmissionsPipelineStage, AdmissionsPipelineTab } from "@/lib/platform-admissions-pipeline-contract";
import { admissionsPipelineStage } from "@/lib/v3/wording";

/**
 * Слова, типы и чистые помощники доски поступления — общие у прежнего и нового вида (`useAdmissionsBoard`). Вынесены из
 * `AdmissionsPipelineBoard.tsx` без изменений.
 */

/** Full sentences only — a saved stage move is silent; removal reports below. */
export const MESSAGES: Record<Exclude<MoveCasePipelineActionStatus, "saved"> | "no_response", string> = {
  invalid: "Не удалось подготовить перемещение.",
  forbidden: "У вашей роли нет прав на это перемещение.",
  request_conflict: "Это уже отправлялось. Попробуйте ещё раз.",
  // 251: «Отменить» и «Вернуть в воронку» идут с версией — дело переместили после нашего перемещения.
  moved: "Дело уже переместили — отмена не выполнена.",
  unavailable: "Не удалось подтвердить перемещение. Обновите страницу и проверьте этап.",
  no_response: "Ответ сервера не получен. Перемещение не подтверждено — обновите страницу.",
};

/** A lost response is not a confirmed move: the card reverts like any refusal. */
export const NO_RESPONSE = { status: "no_response" } as const;

export type MoveTarget =
  | Readonly<{ remove: true }>
  | Readonly<{ remove?: false; stage: AdmissionsPipelineStage }>;

/**
 * Removal is a hide, not a delete (187: `pipeline_hidden_at`, the case stays in
 * «Студенты»). «Вернуть в воронку» is the same move command with the previous
 * stage, which clears the hide server-side — no new server semantics. Since
 * 251 it carries the version of the removal receipt: someone else's later move
 * of the case is never overwritten.
 */
export type RemovalNotice = Readonly<{
  row: AdmissionsPipelineRow;
  phase: "removing" | "removed" | "restoring" | "restored";
  /** Version from the removal receipt (251); null — a receipt without one. */
  version?: number | null;
}>;

/** How the move was made: the menu is the keyboard and phone path — «Отменить» takes focus. */
export type MoveVia = "menu" | "drag";

/** A saved move into the other tab leaves this board: say where it went. */
export type CrossTabHint = Readonly<{ studentCaseId: string; tab: AdmissionsPipelineTab; name: string; stage: AdmissionsPipelineStage }>;

/**
 * Строка ошибки доски — одна на событие: причина, где дело сейчас (отказ
 * `moved`, 251) и ссылка в другой раздел, если дело теперь там.
 */
export type BoardError = Readonly<{ message: string; where?: string | null; hint?: CrossTabHint | null }>;

/** Где дело сейчас по ответу сервера — словами, в той же строке, что отказ. */
export function whereNow(name: string, position: BoardServerPosition | null): string | null {
  if (!position) return null;
  return position.hidden
    ? `Сейчас дело «${name}» убрано из воронки.`
    : `Сейчас дело «${name}» — в «${admissionsPipelineStage(position.stage)}».`;
}

export function removalMessage({ row, phase }: RemovalNotice): string {
  const name = row.studentDisplayName;
  switch (phase) {
    case "removing":
      return `Убираем дело «${name}» из воронки…`;
    case "removed":
      return `Дело «${name}» убрано из воронки.`;
    case "restoring":
      return `Возвращаем дело «${name}» в воронку…`;
    case "restored":
      return `Дело «${name}» снова в воронке.`;
  }
}

export function caseHref(studentCaseId: string): string {
  return `/v3/profile?case=${studentCaseId}&tab=route`;
}

export function boardHref(basePath: string, params: Readonly<Record<string, string | null>>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== "") search.set(key, value);
  }
  const query = search.toString();
  return query ? `${basePath}?${query}` : basePath;
}
