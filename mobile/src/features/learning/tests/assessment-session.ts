// Прохождение теста (english36, orvis92): ответы без вердикта, автосохранение через 0,9 с после
// выбора (как iPhone), запросы строго по очереди с актуальной ревизией, повтор после обрыва тем же
// замороженным запросом, завершение досылает ответы и несёт их же. Результат и разбор приходят только
// в ответе завершения.
//
// Правила ухода и конфликта взяты у веба (`AssessmentRunner.tsx`, `student-assessment-exit-guard.ts`):
//  - уйти с экрана можно, только когда сервер подтвердил все ответы (`saveForExit`); иначе ответы остаются на экране;
//  - конфликт ревизии (тест изменили на другом устройстве) ответы на экране НЕ заменяет: они остаются, пока студент не
//    нажмёт «Показать сохранённые ответы» и не подтвердит замену (`loadSaved`); до этого выбор и сохранение закрыты.
import { assessmentAnswersFingerprint, type AssessmentAnswers, type AssessmentAttempt, type StudentAssessmentKey } from "@web/lib/student-assessment-contract";

import { PortalDecodeError } from "@/domain/portal-source";
import { cscaFailure, type CscaFailure } from "@/features/learning/csca/api";
import {
  completeAssessmentWrite,
  readAssessmentAttempt,
  saveAssessmentWrite,
  sendAssessment,
  startAssessmentWrite,
  UnreadableReceiptError,
} from "@/features/learning/tests/api";
import { assessmentPageCount, assessmentPageSize, firstOpenPage } from "@/features/learning/tests/paging";
import { randomUUID } from "expo-crypto";
import type { FrozenWrite, RpcTransport } from "@/lib/rpc";

export const ASSESSMENT_SAVE_MS = 900;
export const ASSESSMENT_RETRY_MS = 3_000;
/** Столько неудачных попыток сохранить (или сверить) подряд, и студенту предлагается выйти без сохранения: иначе без связи экран держал бы его вечно. */
export const ASSESSMENT_LEAVE_AFTER_FAILURES = 3;

export type AssessmentSaveStatus = "idle" | "dirty" | "saving" | "saved" | "unconfirmed";
/** Сбои сервера плюс «квитанцию записи не удалось прочитать» (сервер запись принял, повторять нечего, но «повторите запрос» говорить неправда). */
export type AssessmentFailure = CscaFailure | "unreadable";
/** «Показать сохранённые ответы»: идёт чтение или оно не удалось (ответы на экране не тронуты). */
export type AssessmentReloadStatus = "idle" | "loading" | "failed";
export type AssessmentUiState = Readonly<{
  phase: "intro" | "starting" | "running" | "completing" | "result";
  attempt: AssessmentAttempt | null;
  answers: Readonly<AssessmentAnswers>;
  /** Страница теста: `0..pageCount-1` - вопросы, `pageCount` - шаг «Готовы завершить?». */
  page: number;
  saveStatus: AssessmentSaveStatus;
  error: AssessmentFailure | null;
  /** Конфликт ревизии: ответы на экране ещё не сверены с сервером; выбор, завершение и уход закрыты до «Показать сохранённые ответы». */
  reloadRequired: boolean;
  reload: AssessmentReloadStatus;
  /** Есть ответы, которые ещё не лежат на сервере и которые можно досохранить: уход с экрана придерживается (веб: exit guard). */
  unsaved: boolean;
  /** Подряд неудачных попыток сохранить или сверить ответы (обрыв, сбой сервера): после `ASSESSMENT_LEAVE_AFTER_FAILURES` экран предлагает выйти без сохранения. */
  failures: number;
  /** На сервере есть начатая, не завершённая попытка: вместо «Начать тест» «Продолжить». */
  resumable: boolean;
}>;

export type AssessmentEnv = Readonly<{
  transport: RpcTransport;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  newId: () => string;
}>;

export function defaultAssessmentEnv(transport: RpcTransport): AssessmentEnv {
  return { transport, setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>), newId: randomUUID };
}

export class AssessmentSession {
  private state: AssessmentUiState;
  private readonly listeners = new Set<() => void>();
  private readonly pageSize: number;
  private revision = 0;
  private answers: AssessmentAnswers = {};
  private dirty = false;
  private saving: Promise<void> | null = null;
  private completion: Promise<void> | null = null;
  private retry: { write: FrozenWrite } | null = null;
  /** Запрос завершения замораживается: повтор после обрыва уходит с тем же id, пока ответы и ревизия те же. */
  private completeFrozen: { fingerprint: string; revision: number; write: FrozenWrite } | null = null;
  private timer: unknown = null;
  private startWrite: FrozenWrite | null = null;
  private starting = false;
  private disposed = false;
  /** Экран не на виду (другая вкладка или экран сверху): повторы по таймеру стоят, пока студент не вернётся. */
  private paused = false;
  /** Студент подтвердил «Выйти без сохранения»: неотправленное не отправляется ни по таймеру, ни при закрытии экрана (`discard`). */
  private discarded = false;

  constructor(
    private readonly env: AssessmentEnv,
    private readonly instrumentKey: StudentAssessmentKey,
    private knownDraft: string | null,
    initial: AssessmentAttempt | null = null,
  ) {
    this.pageSize = assessmentPageSize(instrumentKey);
    // Открыли конкретную попытку: завершённая показывает результат, черновик продолжается с первого пропущенного (как веб).
    this.state = { phase: initial ? (initial.status === "completed" ? "result" : "running") : "intro", attempt: initial, answers: {}, page: 0, saveStatus: "idle", error: null, reloadRequired: false, reload: "idle", unsaved: false, failures: 0, resumable: knownDraft !== null };
    if (initial && initial.status === "draft") this.adopt(initial, true);
    if (initial) this.state = { ...this.state, attempt: initial };
  }

  getState = (): AssessmentUiState => this.state;
  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  debug = () => ({ revision: this.revision, retry: this.retry?.write.requestId ?? null, dirty: this.dirty, completeRequest: this.completeFrozen?.write.requestId ?? null });

  private patch(next: Partial<AssessmentUiState>): void {
    if (this.disposed) return;
    const merged = { ...this.state, ...next };
    // «Придержать уход»: ответ ждёт отправки, летит, не подтверждён после обрыва, идёт завершение или нужна сверка после конфликта.
    // Отказ без повтора (доступ закрыт, ответ не принят) сюда не входит: досохранить там нечего, и экран не должен держать студента.
    const unsaved = merged.phase !== "result" && (merged.reloadRequired || merged.phase === "completing" || merged.saveStatus === "dirty" || merged.saveStatus === "saving" || this.retry !== null);
    this.state = { ...merged, unsaved };
    for (const l of this.listeners) l();
  }

  /**
   * Экран закрыт (свайп назад, выход, выход из кабинета): ответы, которые ещё не ушли, отправляются «по возможности»
   * (запрос идёт и после закрытия), повторов по таймеру больше нет. Кроме «Выйти без сохранения» (`discard`): там студент
   * подтвердил, что несохранённое пропадёт, и `flush` ничего не шлёт, так что закрытие экрана тоже ничего не отправит.
   */
  dispose(): void {
    if (this.disposed) return;
    if (this.state.attempt?.status === "draft" && !this.state.reloadRequired && (this.dirty || this.retry !== null)) void this.flush().catch(() => undefined);
    this.disposed = true;
    if (this.timer) this.env.clearTimer(this.timer);
    this.timer = null;
  }

  private adopt(attempt: AssessmentAttempt, resetPage: boolean): void {
    this.revision = attempt.revision;
    this.answers = { ...attempt.answers };
    this.dirty = false;
    this.retry = null;
    this.completeFrozen = null;
    const page = resetPage ? firstOpenPage(attempt.questions, attempt.answers, this.pageSize) : this.state.page;
    this.state = { ...this.state, attempt, answers: { ...this.answers }, page, failures: 0 };
  }

  /** «Начать» или «Продолжить»: известный черновик читается, иначе открывается новая попытка. */
  async start(): Promise<void> {
    if (this.starting) return;
    this.starting = true;
    this.patch({ phase: "starting", error: null });
    try {
      let attempt: AssessmentAttempt;
      if (this.knownDraft) attempt = await readAssessmentAttempt(this.env.transport, this.knownDraft);
      else {
        // Запрос старта замораживается один раз: повтор тем же p_request_id.
        this.startWrite ??= startAssessmentWrite(this.instrumentKey, this.env.newId());
        attempt = await sendAssessment(this.env.transport, this.startWrite);
      }
      this.startWrite = null;
      if (attempt.status === "completed") {
        this.knownDraft = null; // черновик уже завершён (на другом устройстве): продолжать нечего
        return this.patch({ phase: "result", attempt, resumable: false });
      }
      this.adopt(attempt, true);
      this.patch({ phase: "running", attempt, answers: { ...this.answers }, page: this.state.page });
    } catch (error) {
      const code = cscaFailure(error);
      this.patch({ phase: "intro", error: code === "denied" ? "denied" : "unavailable" });
    } finally {
      this.starting = false;
    }
  }

  select(questionId: string, optionId: string): void {
    // Веб: пока идёт завершение или нужна сверка после конфликта, выбор закрыт.
    if (this.state.phase !== "running" || this.state.reloadRequired) return;
    this.answers = { ...this.answers, [questionId]: optionId };
    this.dirty = true;
    this.patch({ answers: { ...this.answers }, saveStatus: "dirty" });
    if (this.retry) return; // таймер повтора не сбивается
    this.armSaveTimer();
  }

  /** Отправка через 0,9 с после выбора; прежний таймер снимается (иначе его ручка потерялась бы, а сам он сработал бы после закрытия экрана). */
  private armSaveTimer(): void {
    if (this.timer) this.env.clearTimer(this.timer);
    this.timer = this.env.setTimer(() => {
      this.timer = null;
      void this.flush();
    }, ASSESSMENT_SAVE_MS);
  }

  /** Перейти на страницу (`0..pageCount`; последняя - шаг завершения). Во время завершения страницы закрыты, как в вебе. */
  goTo(page: number): void {
    const attempt = this.state.attempt;
    if (!attempt || this.state.phase !== "running") return;
    this.patch({ page: Math.min(Math.max(0, page), assessmentPageCount(attempt.questions.length, this.pageSize)) });
  }

  /** Всё, что нужно сохранить, подтверждено сервером (или сохранять нечего), и нет конфликта, ждущего сверки. */
  private confirmed(): boolean {
    return !this.dirty && this.retry === null && !this.state.reloadRequired;
  }

  /**
   * Отправить несохранённое. `true`: слать больше нечего (сервер подтвердил все ответы на экране или отказ окончательный,
   * как «доступ закрыт»: повторять бессмысленно). `false`: связи нет или нужна сверка после конфликта, ответы остаются
   * на экране и уходить рано.
   */
  async flush(): Promise<boolean> {
    while (this.saving) await this.saving;
    if (this.discarded) return true; // студент выбрал не сохранять: слать больше нечего
    const attempt = this.state.attempt;
    if (!attempt || attempt.status !== "draft" || this.state.phase === "result") return this.confirmed();
    if (this.state.reloadRequired) return false;
    if (!this.dirty && !this.retry) return true;
    if (this.timer) {
      this.env.clearTimer(this.timer);
      this.timer = null;
    }
    const run = this.sendOnce(attempt);
    this.saving = run;
    try {
      await run;
    } finally {
      if (this.saving === run) this.saving = null;
    }
    if (this.dirty && !this.retry && !this.disposed && !this.state.reloadRequired) return this.flush();
    return this.confirmed();
  }

  /**
   * Перед уходом с экрана («Сохранить и выйти», «назад», свайп): `true` только когда слать больше нечего (см. `flush`).
   * После конфликта уйти нельзя, пока студент не сверит ответы (веб: `reloadBeforeExit`).
   */
  async saveForExit(): Promise<boolean> {
    while (this.completion) await this.completion;
    if (this.state.reloadRequired) return false;
    return this.flush();
  }

  private async sendOnce(attempt: AssessmentAttempt): Promise<void> {
    let request = this.retry;
    if (!request) {
      request = { write: saveAssessmentWrite({ attemptId: attempt.attemptId, expectedRevision: this.revision, answers: { ...this.answers } }, this.env.newId()) };
      this.dirty = false;
    }
    this.patch({ saveStatus: "saving" });
    try {
      const saved = await sendAssessment(this.env.transport, request.write);
      this.retry = null;
      this.revision = saved.revision;
      this.patch({ saveStatus: this.dirty ? "dirty" : "saved", error: null, failures: 0 });
    } catch (error) {
      const code = cscaFailure(error);
      // Ответ, который приложение не смогло разобрать, повтором не лечится: сервер запрос уже принял, а тот же запрос вернёт ту же
      // непонятную квитанцию. Его по таймеру не повторяем, иначе экран был бы заперт навсегда. Ревизия из ответа сохраняется, если она
      // видна: сервер её уже продвинул, и без неё следующий ответ дал бы ложный конфликт.
      if (error instanceof PortalDecodeError) {
        if (error instanceof UnreadableReceiptError && error.revision !== null && error.revision > this.revision) this.revision = error.revision;
        this.retry = null;
        this.patch({ saveStatus: "unconfirmed", error: "unreadable", failures: 0 });
        return;
      }
      // Обрыв и сбой сервера лечатся повтором.
      if (code === "unavailable") {
        // Тот же запрос: сервер мог его уже принять, повтор вернёт ту же квитанцию.
        this.retry = request;
        this.patch({ saveStatus: "unconfirmed", failures: this.state.failures + 1 });
        this.scheduleRetry();
        return;
      }
      this.retry = null;
      if (code === "conflict") {
        // Веб: ответы на экране остаются, пока студент не подтвердит замену сохранёнными (`loadSaved`).
        this.patch({ saveStatus: "unconfirmed", error: "conflict", reloadRequired: true, failures: 0 });
        return;
      }
      // Отказ без повтора (доступ закрыт, ответ не принят): состояние честное, «сохранено» не пишем.
      this.patch({ saveStatus: "unconfirmed", error: code, failures: 0 });
    }
  }

  /** Повтор неподтверждённого сохранения через интервал. Прежний таймер (0,9 с после выбора) снимается: потерянный, он сработал бы после закрытия экрана. */
  private scheduleRetry(): void {
    if (this.timer) {
      this.env.clearTimer(this.timer);
      this.timer = null;
    }
    if (this.disposed || this.paused || this.discarded) return;
    this.timer = this.env.setTimer(() => {
      this.timer = null;
      void this.flush();
    }, ASSESSMENT_RETRY_MS);
  }

  /**
   * «Выйти без сохранения» (студент подтвердил окно): неотправленное отбрасывается по-настоящему. Таймеры снимаются, новых запросов
   * нет: ни повтора, ни досылки при закрытии экрана (`dispose`), ни завершения. Запрос, который уже в полёте, отозвать нельзя.
   * Уход не состоялся (экран остался): `keep()` возвращает всё как было.
   */
  discard(): void {
    if (this.disposed || this.discarded) return;
    this.discarded = true;
    if (this.timer) {
      this.env.clearTimer(this.timer);
      this.timer = null;
    }
  }

  /** После `discard()` экран не ушёл: сохранение продолжается, замороженные запросы те же, ничего не потеряно. */
  keep(): void {
    if (this.disposed || !this.discarded) return;
    this.discarded = false;
    if (this.retry) this.scheduleRetry();
    else if (this.dirty) this.armSaveTimer();
  }

  /**
   * Экран ушёл с виду (другая вкладка, экран сверху) или вернулся. Пока он не на виду, повторов по таймеру нет (иначе без связи
   * запрос шёл бы каждые 3 с из фона); при возвращении неподтверждённое досылается сразу.
   */
  setPaused(paused: boolean): void {
    if (this.disposed || this.paused === paused) return;
    this.paused = paused;
    if (paused) {
      if (this.retry && this.timer) {
        this.env.clearTimer(this.timer);
        this.timer = null;
      }
      return;
    }
    if (this.retry && !this.saving) void this.flush();
  }

  /**
   * «Показать сохранённые ответы» (после подтверждения замены): ответы с сервера заменяют ответы на экране. Не удалось
   * прочитать: ответы на экране остаются, кнопка остаётся (`reload: "failed"`).
   */
  async loadSaved(): Promise<void> {
    const attempt = this.state.attempt;
    if (!attempt || this.state.reload === "loading") return;
    this.patch({ reload: "loading" });
    try {
      const fresh = await readAssessmentAttempt(this.env.transport, attempt.attemptId);
      if (fresh.status === "completed") {
        this.adopt(fresh, false);
        if (this.knownDraft === fresh.attemptId) this.knownDraft = null;
        return this.patch({ phase: "result", attempt: fresh, saveStatus: "idle", error: null, reloadRequired: false, reload: "idle", failures: 0, resumable: this.knownDraft !== null });
      }
      this.adopt(fresh, false);
      this.patch({ attempt: fresh, answers: { ...this.answers }, saveStatus: "saved", error: null, reloadRequired: false, reload: "idle", failures: 0 });
    } catch (error) {
      // Нет связи: ответы на экране остаются, кнопка остаётся. Отказ доступа (`denied`) и ответ, который не удалось разобрать
      // (повтор не поможет): сверять нечего, студента не держим.
      const code = cscaFailure(error);
      const retryable = code === "unavailable" && !(error instanceof PortalDecodeError);
      this.patch({ error: code, reload: "failed", reloadRequired: retryable, failures: retryable ? this.state.failures + 1 : 0 });
    }
  }

  /** «Завершить»: нужны ответы на все вопросы; сначала досылается несохранённое. */
  async complete(): Promise<void> {
    const attempt = this.state.attempt;
    if (!attempt || this.state.phase !== "running" || this.state.reloadRequired || this.discarded) return;
    if (attempt.questions.some((q) => !(q.id in this.answers))) return this.patch({ error: "invalid" });
    this.patch({ phase: "completing", error: null });
    const run = this.runComplete(attempt);
    this.completion = run;
    try {
      await run;
    } finally {
      if (this.completion === run) this.completion = null;
    }
  }

  private async runComplete(attempt: AssessmentAttempt): Promise<void> {
    await this.flush();
    if (this.disposed) return;
    // Студент выбрал «Выйти без сохранения», пока шло завершение: запрос завершения не уходит (замороженный остаётся на месте).
    if (this.discarded) return this.patch({ phase: "running" });
    if (this.state.reloadRequired) return this.patch({ phase: "running" });
    if (this.retry) return this.patch({ phase: "running", error: "unavailable" });
    const fingerprint = assessmentAnswersFingerprint(this.answers);
    if (!this.completeFrozen || this.completeFrozen.fingerprint !== fingerprint || this.completeFrozen.revision !== this.revision) {
      this.completeFrozen = { fingerprint, revision: this.revision, write: completeAssessmentWrite({ attemptId: attempt.attemptId, expectedRevision: this.revision, answers: { ...this.answers } }, this.env.newId()) };
    }
    try {
      const done = await sendAssessment(this.env.transport, this.completeFrozen.write);
      this.completeFrozen = null;
      // Завершённая попытка больше не черновик: «Пройти заново» откроет новую, а не прочитает эту ещё раз.
      if (this.knownDraft === attempt.attemptId) this.knownDraft = null;
      this.patch({ phase: "result", attempt: done, error: null, resumable: this.knownDraft !== null });
    } catch (error) {
      const code = cscaFailure(error);
      // Обрыв: тот же запрос уйдёт при следующем нажатии (сервер мог уже его принять). Остальное - новый запрос.
      if (code !== "unavailable") this.completeFrozen = null;
      if (code === "conflict") this.patch({ phase: "running", saveStatus: "unconfirmed", error: "conflict", reloadRequired: true });
      else this.patch({ phase: "running", error: code });
    }
  }

  restart(): void {
    this.startWrite = null;
    this.completeFrozen = null;
    this.retry = null;
    this.dirty = false;
    this.answers = {};
    this.revision = 0;
    this.patch({ phase: "intro", attempt: null, answers: {}, page: 0, saveStatus: "idle", error: null, reloadRequired: false, reload: "idle", failures: 0, resumable: this.knownDraft !== null });
  }
}
