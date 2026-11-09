// Прохождение теста (english36, orvis92): ответы без вердикта, автосохранение через 0,9 с после
// выбора (как iPhone), запросы строго по очереди с актуальной ревизией, повтор после обрыва тем же
// замороженным запросом, завершение досылает ответы и несёт их же. Результат и разбор приходят только
// в ответе завершения.
import type { AssessmentAnswers, AssessmentAttempt, StudentAssessmentKey } from "@web/lib/student-assessment-contract";

import { cscaFailure, type CscaFailure } from "@/features/learning/csca/api";
import {
  completeAssessmentWrite,
  readAssessmentAttempt,
  saveAssessmentWrite,
  sendAssessment,
  startAssessmentWrite,
} from "@/features/learning/tests/api";
import { randomUUID } from "expo-crypto";
import type { FrozenWrite, RpcTransport } from "@/lib/rpc";

export const ASSESSMENT_SAVE_MS = 900;
export const ASSESSMENT_RETRY_MS = 3_000;

export type AssessmentSaveStatus = "idle" | "dirty" | "saving" | "saved" | "unconfirmed";
export type AssessmentUiState = Readonly<{
  phase: "intro" | "starting" | "running" | "completing" | "result";
  attempt: AssessmentAttempt | null;
  answers: Readonly<AssessmentAnswers>;
  index: number;
  saveStatus: AssessmentSaveStatus;
  error: CscaFailure | null;
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
  private revision = 0;
  private answers: AssessmentAnswers = {};
  private dirty = false;
  private saving: Promise<void> | null = null;
  private retry: { write: FrozenWrite } | null = null;
  private timer: unknown = null;
  private startWrite: FrozenWrite | null = null;
  private disposed = false;

  constructor(
    private readonly env: AssessmentEnv,
    private readonly instrumentKey: StudentAssessmentKey,
    private readonly knownDraft: string | null,
    initial: AssessmentAttempt | null = null,
  ) {
    this.state = { phase: initial?.status === "completed" ? "result" : "intro", attempt: initial, answers: {}, index: 0, saveStatus: "idle", error: null };
    if (initial && initial.status === "draft") this.adopt(initial);
    if (initial) this.state = { ...this.state, attempt: initial };
  }

  getState = (): AssessmentUiState => this.state;
  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  debug = () => ({ revision: this.revision, retry: this.retry?.write.requestId ?? null, dirty: this.dirty });
  private patch(next: Partial<AssessmentUiState>): void {
    if (this.disposed) return;
    this.state = { ...this.state, ...next };
    for (const l of this.listeners) l();
  }
  dispose(): void {
    this.disposed = true;
    if (this.timer) this.env.clearTimer(this.timer);
    this.timer = null;
  }

  private adopt(attempt: AssessmentAttempt): void {
    this.revision = attempt.revision;
    this.answers = { ...attempt.answers };
    this.dirty = false;
    this.retry = null;
    const firstOpen = attempt.questions.findIndex((q) => !(q.id in attempt.answers));
    this.state = { ...this.state, attempt, answers: { ...this.answers }, index: firstOpen === -1 ? 0 : firstOpen };
  }

  /** «Начать» или «Продолжить»: известный черновик читается, иначе открывается новая попытка. */
  async start(): Promise<void> {
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
      if (attempt.status === "completed") return this.patch({ phase: "result", attempt });
      this.adopt(attempt);
      this.patch({ phase: "running", attempt, answers: { ...this.answers }, index: this.state.index });
    } catch (error) {
      const code = cscaFailure(error);
      this.patch({ phase: "intro", error: code === "denied" ? "denied" : "unavailable" });
    }
  }

  select(questionId: string, optionId: string): void {
    if (this.state.phase !== "running") return;
    this.answers = { ...this.answers, [questionId]: optionId };
    this.dirty = true;
    this.patch({ answers: { ...this.answers }, saveStatus: "dirty" });
    if (this.retry) return; // таймер повтора не сбивается
    if (this.timer) this.env.clearTimer(this.timer);
    this.timer = this.env.setTimer(() => {
      this.timer = null;
      void this.flush();
    }, ASSESSMENT_SAVE_MS);
  }

  goTo(index: number): void {
    const attempt = this.state.attempt;
    if (!attempt) return;
    this.patch({ index: Math.min(Math.max(0, index), attempt.questions.length) });
  }

  async flush(): Promise<void> {
    while (this.saving) await this.saving;
    const attempt = this.state.attempt;
    if (!attempt || (!this.dirty && !this.retry)) return;
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
    if (this.dirty && !this.retry && !this.disposed) await this.flush();
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
      this.patch({ saveStatus: this.dirty ? "dirty" : "saved", error: null });
    } catch (error) {
      const code = cscaFailure(error);
      if (code === "unavailable") {
        // Тот же запрос: сервер мог его уже принять, повтор вернёт ту же квитанцию.
        this.retry = request;
        this.patch({ saveStatus: "unconfirmed" });
        this.timer = this.env.setTimer(() => void this.flush(), ASSESSMENT_RETRY_MS);
        return;
      }
      this.retry = null;
      if (code === "conflict") {
        await this.reload();
        return;
      }
      this.patch({ saveStatus: "idle", error: code });
    }
  }

  /** Конфликт ревизии: показать сохранённые ответы сервера. */
  async reload(): Promise<void> {
    const attempt = this.state.attempt;
    if (!attempt) return;
    try {
      const fresh = await readAssessmentAttempt(this.env.transport, attempt.attemptId);
      if (fresh.status === "completed") return this.patch({ phase: "result", attempt: fresh, saveStatus: "idle" });
      this.adopt(fresh);
      this.patch({ attempt: fresh, answers: { ...this.answers }, saveStatus: "saved", error: "conflict" });
    } catch (error) {
      this.patch({ error: cscaFailure(error) });
    }
  }

  /** «Завершить»: нужны ответы на все вопросы; сначала досылается несохранённое. */
  async complete(): Promise<void> {
    const attempt = this.state.attempt;
    if (!attempt || this.state.phase === "completing") return;
    if (attempt.questions.some((q) => !(q.id in this.answers))) return this.patch({ error: "invalid" });
    this.patch({ phase: "completing", error: null });
    await this.flush();
    if (this.retry) {
      this.patch({ phase: "running", error: "unavailable" });
      return;
    }
    const write = completeAssessmentWrite({ attemptId: attempt.attemptId, expectedRevision: this.revision, answers: { ...this.answers } }, this.env.newId());
    try {
      const done = await sendAssessment(this.env.transport, write);
      this.patch({ phase: "result", attempt: done, error: null });
    } catch (error) {
      const code = cscaFailure(error);
      if (code === "conflict") await this.reload();
      this.patch({ phase: "running", error: code });
    }
  }

  restart(): void {
    this.startWrite = null;
    this.retry = null;
    this.dirty = false;
    this.answers = {};
    this.revision = 0;
    this.patch({ phase: "intro", attempt: null, answers: {}, index: 0, saveStatus: "idle", error: null });
  }
}
