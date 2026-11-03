/**
 * «Отменить» на доске поступления (Э7, миграция 251) — правила без React.
 *
 * После подтверждённого перемещения (перетаскиванием или меню) доска
 * предлагает одну отмену: обратное перемещение той же командой
 * `move_case_pipeline_v2` с версией из квитанции. Сервер отказывает
 * (`moved`), если дело за это время переместили, и называет, где оно сейчас.
 * Файл без React: его проверяет unit-тест.
 */
import type {
  AdmissionsPipelineRow,
  AdmissionsPipelineStage,
} from "@/lib/platform-admissions-pipeline-contract";

/** Сколько держится «Отменить» после перемещения — как у «Задач» (6 с). */
export const BOARD_UNDO_MS = 6000;

export type BoardUndoOffer = Readonly<{
  /** Ключ запроса подтверждённого перемещения: одна строка на одно перемещение. */
  key: string;
  /** Карточка до перемещения: её этап — куда вернёт «Отменить». */
  row: AdmissionsPipelineRow;
  toStage: AdmissionsPipelineStage;
  /** Версия положения из квитанции перемещения (251). */
  version: number;
  /** Перемещение из меню: фокус встаёт на «Отменить». Перетаскивание фокус не трогает. */
  focus: boolean;
  /** Отмена отправлена: кнопка ждёт ответа сервера. */
  pending: boolean;
  completedAt: number;
  expiresAt: number;
}>;

export function boardUndoOffer(
  input: Readonly<{
    key: string;
    row: AdmissionsPipelineRow;
    toStage: AdmissionsPipelineStage;
    version: number;
    focus: boolean;
  }>,
  now: number,
): BoardUndoOffer {
  return { ...input, pending: false, completedAt: now, expiresAt: now + BOARD_UNDO_MS };
}

/** Положение, которое назвал сервер при отказе `moved`. */
export type BoardServerPosition = Readonly<{ stage: AdmissionsPipelineStage; hidden: boolean }>;

/**
 * Карточка после отмены, которая не прошла: там, где её положение назвал
 * сервер (убрана из воронки — уходит с доски); без положения — там, где её
 * оставило подтверждённое перемещение. Другие карточки не трогаются.
 */
export function placeAfterRefusedUndo(
  cards: readonly AdmissionsPipelineRow[],
  offer: BoardUndoOffer,
  position: BoardServerPosition | null,
): AdmissionsPipelineRow[] {
  const id = offer.row.studentCaseId;
  if (position?.hidden) return cards.filter((row) => row.studentCaseId !== id);
  const stage = position?.stage ?? offer.toStage;
  const present = cards.some((row) => row.studentCaseId === id);
  if (!present) return [...cards, { ...offer.row, pipelineStage: stage }];
  return cards.map((row) => (row.studentCaseId === id ? { ...row, pipelineStage: stage } : row));
}
