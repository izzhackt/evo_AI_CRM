// Урок английского: ответы по одному, каждый финален (вердикт и разбор из ответа сервера), попытка
// открывается первым ответом и завершается кнопкой «Завершить урок» (правило веба LessonRunner).
// Каждая запись замораживается: повтор после обрыва идёт тем же p_request_id и аргументами.
import type { LearningAnswer, LearningAnswerEntry, LearningAttempt, LearningExercise, LearningLessonView } from "@web/lib/portal/learning";
import { firstUnansweredIndex } from "@web/lib/portal/learning";

import {
  answerEnglishWrite,
  completeEnglishWrite,
  readEnglishLesson,
  sendEnglishAnswer,
  sendEnglishAttempt,
  startEnglishWrite,
} from "@/features/learning/english/api";
import { cscaFailure, type CscaFailure } from "@/features/learning/csca/api";
import { randomUUID } from "expo-crypto";
import type { FrozenWrite, RpcTransport } from "@/lib/rpc";

export type EnglishRunState = Readonly<{
  attemptId: string | null;
  revision: number | null;
  answers: Readonly<Record<string, Pick<LearningAnswerEntry, "answer" | "correct" | "verdict" | "explain">>>;
  index: number;
  completed: boolean;
  busy: boolean;
  error: CscaFailure | null;
}>;

export class EnglishSession {
  private state: EnglishRunState;
  private readonly listeners = new Set<() => void>();
  private startWrite: FrozenWrite | null = null;
  private pending: { exerciseId: string; key: string; write: FrozenWrite | null } | null = null;
  private completeId: string | null = null;
  private busy = false;

  constructor(
    private readonly transport: RpcTransport,
    private readonly lessonId: string,
    private readonly exercises: readonly LearningExercise[],
    draft: LearningAttempt | null,
    latestCompleted: LearningAttempt | null,
    private readonly newId: () => string = randomUUID,
  ) {
    const source = draft ?? latestCompleted;
    const answers = source ? Object.fromEntries(Object.entries(source.answers).map(([id, e]) => [id, { answer: e.answer, correct: e.correct, verdict: e.verdict, explain: e.explain }])) : {};
    this.state = {
      attemptId: draft?.attemptId ?? null,
      revision: draft?.revision ?? null,
      answers,
      index: draft ? firstUnansweredIndex(exercises, answers) : 0,
      completed: !draft && latestCompleted !== null,
      busy: false,
      error: null,
    };
  }

  getState = (): EnglishRunState => this.state;
  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  private patch(next: Partial<EnglishRunState>): void {
    this.state = { ...this.state, ...next };
    for (const l of this.listeners) l();
  }

  /** Ответить на текущее упражнение. `answer` уже проверен по форме (`exerciseValueToAnswer`). */
  async answer(answer: LearningAnswer): Promise<void> {
    const exercise = this.exercises[this.state.index];
    if (!exercise || this.busy || this.state.answers[exercise.exerciseId]) return;
    const key = JSON.stringify(answer);
    // Тот же ответ после сбоя: тот же замороженный запрос; другой ответ это новый запрос.
    if (!(this.pending?.exerciseId === exercise.exerciseId && this.pending.key === key)) this.pending = { exerciseId: exercise.exerciseId, key, write: null };
    const pending = this.pending;
    this.busy = true;
    this.patch({ busy: true, error: null });
    try {
      let attemptId = this.state.attemptId;
      let revision = this.state.revision;
      if (attemptId === null) {
        this.startWrite ??= startEnglishWrite(this.lessonId, this.newId());
        const attempt = await sendEnglishAttempt(this.transport, this.startWrite);
        attemptId = attempt.attemptId;
        revision = attempt.revision;
        this.patch({ attemptId, revision });
      }
      pending.write ??= answerEnglishWrite({ attemptId, expectedRevision: revision as number, exerciseId: exercise.exerciseId, answer }, this.newId());
      const receipt = await sendEnglishAnswer(this.transport, pending.write);
      this.pending = null;
      this.patch({
        revision: receipt.revision,
        answers: { ...this.state.answers, [receipt.exerciseId]: { answer, correct: receipt.correct, verdict: receipt.verdict, explain: receipt.explain } },
      });
    } catch (error) {
      const code = cscaFailure(error);
      if (code !== "unavailable") this.pending = null;
      this.patch({ error: code });
    } finally {
      this.busy = false;
      this.patch({ busy: false });
    }
  }

  next(): void {
    const target = this.state.index + 1;
    this.patch({ index: Math.min(target, this.exercises.length), error: null });
  }

  /** «Завершить урок»: все ответы есть. Тот же запрос при повторе. */
  async finish(): Promise<void> {
    const { attemptId, revision } = this.state;
    if (this.busy || attemptId === null || revision === null) return;
    this.busy = true;
    this.patch({ busy: true, error: null });
    try {
      this.completeId ??= this.newId();
      await sendEnglishAttempt(this.transport, completeEnglishWrite({ attemptId, expectedRevision: revision }, this.completeId));
      this.patch({ completed: true, attemptId: null, revision: null });
    } catch (error) {
      this.patch({ error: cscaFailure(error) });
    } finally {
      this.busy = false;
      this.patch({ busy: false });
    }
  }

  /** Конфликт ревизии: свежее состояние с сервера. */
  async reload(): Promise<void> {
    let view: LearningLessonView;
    try {
      view = await readEnglishLesson(this.transport, this.lessonId);
    } catch (error) {
      this.patch({ error: cscaFailure(error) });
      return;
    }
    this.pending = null;
    const source = view.draft ?? view.latestCompleted;
    const answers = source ? Object.fromEntries(Object.entries(source.answers).map(([id, e]) => [id, { answer: e.answer, correct: e.correct, verdict: e.verdict, explain: e.explain }])) : {};
    this.patch({ answers, attemptId: view.draft?.attemptId ?? null, revision: view.draft?.revision ?? null, index: firstUnansweredIndex(this.exercises, answers), completed: !view.draft && view.latestCompleted !== null, error: null });
  }

  restart(): void {
    this.startWrite = null;
    this.completeId = null;
    this.pending = null;
    this.patch({ attemptId: null, revision: null, answers: {}, index: 0, completed: false, error: null });
  }
}
