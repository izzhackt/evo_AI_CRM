// Урок английского: ответы по одному, каждый финален (вердикт и разбор из ответа сервера), попытка
// открывается кнопкой «Начать урок» (как на сайте; если её не нажимали, первым ответом) и завершается кнопкой
// «Завершить урок» (правило веба LessonRunner).
// Каждая запись замораживается: повтор после обрыва идёт тем же p_request_id и аргументами; новая попытка («Пройти ещё раз»)
// получает новые идентификаторы старта и завершения: сервер на повторный p_request_id отдаёт сохранённую квитанцию
// (старую попытку), и первая же запись в «новую» упала бы конфликтом.
import type { LearningAnswer, LearningAnswerEntry, LearningAttempt, LearningExercise, LearningLessonView, LearningResult } from "@web/lib/portal/learning";
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
  /** Итог последней завершённой попытки (счёт и номера заданий с ошибками): экран завершения показывает его, а не пересчитывает. */
  result: LearningResult | null;
  busy: boolean;
  error: CscaFailure | null;
}>;

type AnswerEntries = EnglishRunState["answers"];

function answersOf(attempt: LearningAttempt | null): AnswerEntries {
  return attempt ? Object.fromEntries(Object.entries(attempt.answers).map(([id, e]) => [id, { answer: e.answer, correct: e.correct, verdict: e.verdict, explain: e.explain }])) : {};
}

export class EnglishSession {
  private state: EnglishRunState;
  private readonly listeners = new Set<() => void>();
  private startWrite: FrozenWrite | null = null;
  private beginning: Promise<boolean> | null = null;
  private pending: { exerciseId: string; key: string; write: FrozenWrite | null } | null = null;
  private completeWrite: FrozenWrite | null = null;
  private busy = false;
  /** Студент вышел из аккаунта: ни одного запроса с отозванным токеном, ни по кнопке, ни при закрытии экрана (`abandon`). */
  private abandoned = false;
  /** Запросы, уже повторённые при закрытии экрана: второй вызов `dispose` (двойная очистка эффекта) их не шлёт ещё раз. */
  private readonly resent = new WeakSet<FrozenWrite>();

  constructor(
    private readonly transport: RpcTransport,
    private readonly lessonId: string,
    private readonly exercises: readonly LearningExercise[],
    draft: LearningAttempt | null,
    latestCompleted: LearningAttempt | null,
    private readonly newId: () => string = randomUUID,
  ) {
    const source = draft ?? latestCompleted;
    const answers = answersOf(source);
    this.state = {
      attemptId: draft?.attemptId ?? null,
      revision: draft?.revision ?? null,
      answers,
      index: draft ? firstUnansweredIndex(exercises, answers) : 0,
      completed: !draft && latestCompleted !== null,
      result: !draft ? (latestCompleted?.result ?? null) : null,
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

  /**
   * Открыть попытку, если её ещё нет: «Начать урок» создаёт черновик сразу, как на сайте. Повтор после обрыва - тот же запрос;
   * двойное нажатие шлёт один запрос и отдаёт обоим один ответ. Ответ сервера принимается целиком, как на сайте (`start()` в
   * LessonRunner): если черновик уже начат на другом устройстве, его ответы и первое неотвеченное задание берутся оттуда, иначе
   * первый ответ упал бы отказом «задание уже отвечено».
   */
  begin(): Promise<boolean> {
    if (this.beginning) return this.beginning;
    if (this.busy || this.abandoned) return Promise.resolve(false);
    if (this.state.attemptId !== null) return Promise.resolve(true);
    const run = this.runBegin().finally(() => {
      this.beginning = null;
    });
    this.beginning = run;
    return run;
  }

  private async runBegin(): Promise<boolean> {
    this.busy = true;
    this.patch({ busy: true, error: null });
    try {
      this.startWrite ??= startEnglishWrite(this.lessonId, this.newId());
      this.adoptStarted(await sendEnglishAttempt(this.transport, this.startWrite));
      return true;
    } catch (error) {
      this.patch({ error: cscaFailure(error) });
      return false;
    } finally {
      this.busy = false;
      this.patch({ busy: false });
    }
  }

  /** Состояние открытой (или уже начатой) попытки с сервера: ответы, первое неотвеченное задание, итог прежней попытки сброшен. */
  private adoptStarted(attempt: LearningAttempt): void {
    const answers = answersOf(attempt);
    this.patch({ attemptId: attempt.attemptId, revision: attempt.revision, answers, index: firstUnansweredIndex(this.exercises, answers), completed: false, result: null });
  }

  /** Ответить на текущее упражнение. `answer` уже проверен по форме (`exerciseValueToAnswer`). */
  async answer(answer: LearningAnswer): Promise<void> {
    const exercise = this.exercises[this.state.index];
    if (!exercise || this.busy || this.abandoned || this.state.answers[exercise.exerciseId]) return;
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
        this.adoptStarted(attempt);
        // Черновик уже начат в другом месте и это задание в нём отвечено: на экране теперь оно с разбором, второй ответ не шлём.
        if (attempt.answers[exercise.exerciseId]) {
          this.pending = null;
          return;
        }
        attemptId = attempt.attemptId;
        revision = attempt.revision;
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

  /**
   * «Завершить урок»: все ответы есть. Тот же запрос при повторе после обрыва; любой другой отказ сбрасывает замороженный запрос
   * (как `completeRequestId.current = null` на сайте). `true` только когда сервер завершил попытку: экран после успеха обновляет
   * список, после отказа не трогает ничего.
   */
  async finish(): Promise<boolean> {
    const { attemptId, revision } = this.state;
    if (this.busy || this.abandoned || attemptId === null || revision === null) return false;
    this.busy = true;
    this.patch({ busy: true, error: null });
    try {
      this.completeWrite ??= completeEnglishWrite({ attemptId, expectedRevision: revision }, this.newId());
      const done = await sendEnglishAttempt(this.transport, this.completeWrite);
      this.completeWrite = null;
      this.patch({ completed: true, attemptId: null, revision: null, result: done.result });
      return true;
    } catch (error) {
      const code = cscaFailure(error);
      if (code !== "unavailable") this.completeWrite = null;
      this.patch({ error: code });
      return false;
    } finally {
      this.busy = false;
      this.patch({ busy: false });
    }
  }

  /** Конфликт ревизии: свежее состояние с сервера. */
  async reload(): Promise<void> {
    if (this.abandoned) return;
    let view: LearningLessonView;
    try {
      view = await readEnglishLesson(this.transport, this.lessonId);
    } catch (error) {
      this.patch({ error: cscaFailure(error) });
      return;
    }
    this.pending = null;
    this.completeWrite = null;
    const source = view.draft ?? view.latestCompleted;
    const answers = answersOf(source);
    this.patch({
      answers,
      attemptId: view.draft?.attemptId ?? null,
      revision: view.draft?.revision ?? null,
      index: firstUnansweredIndex(this.exercises, answers),
      completed: !view.draft && view.latestCompleted !== null,
      result: !view.draft ? (view.latestCompleted?.result ?? null) : null,
      error: null,
    });
  }

  /** «Пройти ещё раз»: всё прежнее забыто, включая замороженные запросы старта и завершения (новая попытка - новые идентификаторы). */
  restart(): void {
    this.startWrite = null;
    this.completeWrite = null;
    this.pending = null;
    this.patch({ attemptId: null, revision: null, answers: {}, index: 0, completed: false, result: null, error: null });
  }

  /**
   * Экран закрыт. Ответ в уроке финален и уходит по кнопке «Ответить», поэтому выбранный, но не отправленный ответ не досылается.
   * Досылается только то, что студент уже отправил, а подтверждения нет (обрыв): один повтор того же замороженного запроса. Запись
   * идемпотентна по `p_request_id` (если сервер уже принял её, вернётся та же квитанция), поэтому повтор безопасен; не вышло
   * и на этот раз, ответ придётся дать заново. Повторов по таймеру и окна с вопросом нет: выход из урока ничем не заперт.
   * `onConfirmed` зовётся, когда сервер подтвердил такую досылку: список уроков к этому часу уже перечитан (при возврате на экран) и
   * не знает про завершённый или начатый урок, поэтому экран просит его перечитать (иначе плитка «Пройден» появилась бы только после
   * следующего ухода и возврата).
   */
  dispose(onConfirmed?: () => void): void {
    if (this.abandoned || this.busy || this.state.error !== "unavailable") return;
    const answerWrite = this.pending?.write ?? null;
    if (answerWrite && !this.resent.has(answerWrite)) {
      this.resent.add(answerWrite);
      void sendEnglishAnswer(this.transport, answerWrite).then(() => onConfirmed?.(), () => undefined);
    }
    const completeWrite = this.completeWrite;
    if (completeWrite && !this.resent.has(completeWrite)) {
      this.resent.add(completeWrite);
      void sendEnglishAttempt(this.transport, completeWrite).then(() => onConfirmed?.(), () => undefined);
    }
  }

  /** Выход из аккаунта: токен отозван, любой запрос кончился бы 401. Окончательно: ни кнопки, ни закрытие экрана больше ничего не шлют. */
  abandon(): void {
    this.abandoned = true;
  }
}
