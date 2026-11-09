// «Проверка» урока и «Практика» (движок 198, тип `item`): задания по одному, ответ финален и сразу
// возвращает вердикт и разбор каждого варианта. Первый ответ открывает попытку, последний её
// завершает (одно действие на ответ). Порт ItemRunner веба и CSCALessonModel iPhone без UI.
// Каждая запись замораживается: повтор после обрыва идёт с ТЕМ ЖЕ p_request_id и аргументами.
import type { CscaExplain, CscaLessonAttempt, CscaLessonItem, CscaLessonView, CscaOptionId } from "@web/lib/portal/csca";

import {
  completeLessonWrite,
  cscaFailure,
  readCscaLessonV2,
  saveAnswerWrite,
  sendAnswer,
  sendStartLesson,
  startLessonWrite,
  type CscaFailure,
} from "@/features/learning/csca/api";
import { rpcWrite, type FrozenWrite, type RpcTransport } from "@/lib/rpc";
import { randomUUID } from "expo-crypto";

export type Answered = Readonly<{ selected: CscaOptionId; correct: boolean; explain: CscaExplain }>;

export type LessonRunState = Readonly<{
  attemptId: string | null;
  revision: number | null;
  answered: Readonly<Record<string, Answered>>;
  finished: boolean;
  index: number;
  selected: CscaOptionId | null;
  busy: boolean;
  error: CscaFailure | null;
}>;

function answeredFrom(attempt: CscaLessonAttempt | null): Record<string, Answered> {
  if (!attempt) return {};
  return Object.fromEntries(
    Object.entries(attempt.answers).map(([id, e]) => [id, { selected: e.selected, correct: e.correct, explain: e.explain }]),
  );
}

export function firstOpen(items: readonly CscaLessonItem[], answered: Readonly<Record<string, Answered>>): number {
  const index = items.findIndex((entry) => !(entry.exerciseId in answered));
  return index === -1 ? items.length : index;
}

type Pending = { exerciseId: string; selected: CscaOptionId; write: FrozenWrite | null };

export class LessonSession {
  private state: LessonRunState;
  private readonly listeners = new Set<() => void>();
  private pending: Pending | null = null;
  // Идентификаторы запросов одной попытки живут до «Пройти ещё раз».
  private startWrite: FrozenWrite | null = null;
  private completeId: string | null = null;
  private busy = false;

  constructor(
    private readonly transport: RpcTransport,
    private readonly lessonId: string,
    private readonly items: readonly CscaLessonItem[],
    draft: CscaLessonAttempt | null,
    latestCompleted: CscaLessonAttempt | null,
    private readonly newId: () => string = randomUUID,
  ) {
    const answered = answeredFrom(draft ?? latestCompleted);
    this.state = {
      attemptId: draft?.attemptId ?? null,
      revision: draft?.revision ?? null,
      answered,
      finished: !draft && latestCompleted !== null,
      index: draft ? firstOpen(items, answered) : 0,
      selected: null,
      busy: false,
      error: null,
    };
  }

  getState = (): LessonRunState => this.state;
  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  private patch(next: Partial<LessonRunState>): void {
    this.state = { ...this.state, ...next };
    for (const l of this.listeners) l();
  }

  select(option: CscaOptionId): void {
    const current = this.items[this.state.index];
    if (!current || this.state.answered[current.exerciseId] || this.busy) return;
    // Новый выбор после сбоя: прежний запрос больше не повторяем.
    if (this.pending && this.pending.selected !== option) this.pending = null;
    this.patch({ selected: option });
  }

  /** «Проверить»: старт попытки (при первом ответе), ответ, завершение (после последнего). */
  async submit(): Promise<void> {
    const current = this.items[this.state.index];
    if (this.busy || !current || this.state.answered[current.exerciseId]) return;
    const selected = this.state.selected;
    if (!selected && !(this.pending?.exerciseId === current.exerciseId)) return;
    const choice = this.pending?.exerciseId === current.exerciseId ? this.pending.selected : (selected as CscaOptionId);
    this.pending = this.pending?.exerciseId === current.exerciseId ? this.pending : { exerciseId: current.exerciseId, selected: choice, write: null };
    this.busy = true;
    this.patch({ busy: true, error: null });
    try {
      let attemptId = this.state.attemptId;
      let revision = this.state.revision;
      if (attemptId === null) {
        this.startWrite ??= startLessonWrite(this.lessonId, this.newId());
        const attempt = await sendStartLesson(this.transport, this.startWrite);
        attemptId = attempt.attemptId;
        revision = attempt.revision;
        this.patch({ attemptId, revision });
      }
      // Ревизия в запрос замораживается при первой отправке ответа на это задание.
      this.pending.write ??= saveAnswerWrite({ attemptId, expectedRevision: revision as number, exerciseId: current.exerciseId, selected: choice }, this.newId());
      const receipt = await sendAnswer(this.transport, this.pending.write);
      this.pending = null;
      let nextAttemptId: string | null = attemptId;
      let nextRevision: number | null = receipt.revision;
      if (receipt.answeredCount === receipt.exercisesTotal) {
        this.completeId ??= this.newId();
        try {
          await rpcWrite(this.transport, completeLessonWrite({ attemptId, expectedRevision: receipt.revision }, this.completeId));
          nextAttemptId = null;
          nextRevision = null;
        } catch {
          // Ответ принят; завершение повторится кнопкой «Завершить» (тот же запрос).
        }
      }
      this.patch({
        attemptId: nextAttemptId,
        revision: nextRevision,
        answered: { ...this.state.answered, [receipt.exerciseId]: { selected: choice, correct: receipt.correct, explain: receipt.explain } },
        selected: null,
      });
    } catch (error) {
      const code = cscaFailure(error);
      if (code === "conflict" || code === "already_answered") this.pending = null;
      else if (code !== "unavailable") this.pending = null;
      this.patch({ error: code });
    } finally {
      this.busy = false;
      this.patch({ busy: false });
    }
  }

  /** Все ответы есть, а завершение не дошло: завершаем тем же запросом. */
  async finishDraft(): Promise<void> {
    const { attemptId, revision } = this.state;
    if (this.busy || attemptId === null || revision === null) return;
    this.busy = true;
    this.patch({ busy: true, error: null });
    try {
      this.completeId ??= this.newId();
      await rpcWrite(this.transport, completeLessonWrite({ attemptId, expectedRevision: revision }, this.completeId));
      this.patch({ attemptId: null, revision: null });
    } catch (error) {
      this.patch({ error: cscaFailure(error) });
    } finally {
      this.busy = false;
      this.patch({ busy: false });
    }
  }

  /** Свежее состояние урока после конфликта ревизии или повторного ответа. */
  async reload(): Promise<void> {
    let view: CscaLessonView;
    try {
      view = await readCscaLessonV2(this.transport, this.lessonId);
    } catch (error) {
      this.patch({ error: cscaFailure(error) });
      return;
    }
    this.pending = null;
    const source = view.draft ?? view.latestCompleted;
    const answered = answeredFrom(source);
    this.patch({
      answered,
      attemptId: view.draft?.attemptId ?? null,
      revision: view.draft?.revision ?? null,
      finished: !view.draft && view.latestCompleted !== null,
      index: firstOpen(this.items, answered),
      selected: null,
      error: null,
    });
  }

  goTo(next: number): void {
    this.patch({ selected: null, error: null });
    if (next >= this.items.length) this.patch({ finished: true });
    else this.patch({ index: next, finished: false });
  }

  restart(): void {
    this.startWrite = null;
    this.completeId = null;
    this.pending = null;
    this.patch({ attemptId: null, revision: null, answered: {}, finished: false, index: 0, selected: null, error: null });
  }
}
