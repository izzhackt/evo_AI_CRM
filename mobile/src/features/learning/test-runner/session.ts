// Тест на время (контракт §7): порт TimedTestRunner веба и CSCATestRunnerModel iPhone без UI.
//  - Срок держит сервер. Клиентский отсчёт только показывает «Осталось» по МОНОТОННЫМ часам
//    с поправкой на serverNow (оценка не откатывается назад квитанцией: `laterClockOffset`).
//  - Выбор варианта / флажок уходят через 1,5 с, не чаще раза в 2 с; запросы строго по
//    очереди с актуальной ревизией; после обрыва повторяется ТОТ ЖЕ замороженный запрос
//    (тот же p_request_id и тело), затем сразу текущее состояние.
//  - Завершение не теряет неушедшие ответы, пока сервер ещё принимает сохранения.
//  - Пробный тест (allowEarlyFinish = false): кнопки «Завершить» нет, по сроку клиент сам завершает.
//  - Ответы, вердикты, итоги и тексты ошибок сервера не попадают ни в журнал, ни в сообщения.
import {
  clockOffsetMs,
  itemSecondsChanged,
  laterClockOffset,
  remainingSeconds,
  serverAcceptsSave,
  testSavePayload,
  type CscaOptionId,
  type CscaTestAttempt,
} from "@web/lib/portal/csca";

import {
  completeTestWrite,
  cscaFailure,
  readCscaTestAttemptV1,
  saveTestWrite,
  sendTestAttempt,
  sendTestSave,
  startTestWrite,
  type CscaFailure,
} from "@/features/learning/csca/api";
import type { FrozenWrite, RpcTransport } from "@/lib/rpc";
import { randomUUID } from "expo-crypto";

export const SAVE_ON_CHOICE_MS = 1_500;
export const SAVE_ON_MOVE_MS = 2_000;
export const RETRY_MS = 3_000;

export type TestPhase = "intro" | "starting" | "running" | "finishing" | "result";
export type SaveStatus = "idle" | "pending" | "saving" | "saved" | "retrying";
export type SessionNotice = "conflict" | "finishUnsent" | null;

export type TestUiState = Readonly<{
  phase: TestPhase;
  attempt: CscaTestAttempt | null;
  answers: Readonly<Record<string, CscaOptionId>>;
  flags: readonly string[];
  index: number;
  remaining: number | null;
  saveStatus: SaveStatus;
  error: CscaFailure | null;
  notice: SessionNotice;
  /** Остался минут один: объявить один раз. */
  lastMinute: boolean;
}>;

export type SessionEnv = Readonly<{
  transport: RpcTransport;
  /** Монотонные миллисекунды (в приложении `performance.now`). */
  now: () => number;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  newId: () => string;
  wait: (ms: number) => Promise<void>;
}>;

export function defaultEnv(transport: RpcTransport): SessionEnv {
  return {
    transport,
    now: () => performance.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    newId: randomUUID,
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

type SaveRequest = { write: FrozenWrite; expectedRevision: number; itemSeconds: Record<string, number>; sentAnswers: Record<string, CscaOptionId>; flagsVersion: number };

export class CscaTestSession {
  private state: TestUiState;
  private readonly listeners = new Set<() => void>();
  private attempt: CscaTestAttempt | null = null;
  private revision = 0;
  private offset: number | null = null;
  private answers: Record<string, CscaOptionId> = {};
  private flags: string[] = [];
  private seconds: Record<string, number> = {};
  private sentSeconds: Record<string, number> = {};
  private enteredAt: number | null = null;
  private index = 0;
  private dirty = false;
  private saving: Promise<void> | null = null;
  private retry: SaveRequest | null = null;
  private lastSaveAt = -Infinity;
  private batchTimer: unknown = null;
  private tickTimer: unknown = null;
  private finalizing = false;
  private startWrite: FrozenWrite | null = null;
  private disposed = false;
  private visible = true;
  /** Выборы и флажки, ещё не подтверждённые сервером (для повторного наложения после конфликта). */
  private touched = new Set<string>();
  private flagsTouched = false;
  private flagsVersion = 0;

  constructor(
    private readonly env: SessionEnv,
    private readonly formId: string,
    private knownDraft: string | null,
    initialResult: CscaTestAttempt | null = null,
  ) {
    this.state = {
      phase: initialResult ? "result" : "intro",
      attempt: initialResult,
      answers: {},
      flags: [],
      index: 0,
      remaining: null,
      saveStatus: "idle",
      error: null,
      notice: null,
      lastMinute: false,
    };
    this.attempt = initialResult;
  }

  // ---- подписка --------------------------------------------------------------------------
  getState = (): TestUiState => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private patch(next: Partial<TestUiState>): void {
    if (this.disposed) return;
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) listener();
  }

  /** Подробности для тестов: текущая ревизия и поправка часов. */
  debug = () => ({ revision: this.revision, offset: this.offset, dirty: this.dirty, retry: this.retry?.write.requestId ?? null });

  /**
   * Экран закрыт (свайп назад, системная «назад», выход): несохранённые ответы и время на задании
   * уходят «по возможности» (запрос идёт и после закрытия), затем таймеры останавливаются.
   */
  dispose(): void {
    if (this.attempt?.status === "draft" && this.state.phase === "running") void this.flush({ settle: true }).catch(() => undefined);
    this.disposed = true;
    if (this.batchTimer) this.env.clearTimer(this.batchTimer);
    if (this.tickTimer) this.env.clearTimer(this.tickTimer);
    this.batchTimer = null;
    this.tickTimer = null;
  }

  // ---- принятие попытки ------------------------------------------------------------------
  private adopt(next: CscaTestAttempt, receivedAt: number): void {
    this.attempt = next;
    this.revision = next.revision;
    // Старт и чтение попытки несут свежий serverNow: отсчёт ставится по нему (§7.2).
    this.offset = clockOffsetMs(next.serverNow, receivedAt);
    this.answers = { ...next.answers };
    this.flags = [...next.flags];
    this.seconds = { ...next.itemSeconds };
    this.sentSeconds = { ...next.itemSeconds };
    this.dirty = false;
    this.retry = null;
    this.touched.clear();
    this.flagsTouched = false;
    this.patch({ attempt: next, answers: { ...this.answers }, flags: [...this.flags] });
  }

  private settleSeconds(): void {
    const current = this.attempt?.items[this.index];
    if (!current || this.enteredAt === null) return;
    const now = this.env.now();
    const spent = (now - this.enteredAt) / 1000;
    this.enteredAt = this.visible ? now : null;
    if (spent <= 0) return;
    this.seconds = { ...this.seconds, [current.itemKey]: Math.min(3600, (this.seconds[current.itemKey] ?? 0) + spent) };
  }

  private showResult(done: CscaTestAttempt): void {
    this.attempt = done;
    this.stopTicking();
    this.patch({ attempt: done, phase: "result", error: null, notice: null, remaining: null });
  }

  private async reloadAttempt(): Promise<CscaTestAttempt | null> {
    const current = this.attempt;
    if (!current) return null;
    let fresh: CscaTestAttempt;
    try {
      fresh = await readCscaTestAttemptV1(this.env.transport, current.attemptId);
    } catch {
      return null;
    }
    const receivedAt = this.env.now();
    if (fresh.status === "completed") {
      this.showResult(fresh);
      return fresh;
    }
    this.adopt(fresh, receivedAt);
    return fresh;
  }

  // ---- вход в тест -----------------------------------------------------------------------
  private run(draft: CscaTestAttempt, receivedAt: number): void {
    this.adopt(draft, receivedAt);
    const firstOpen = draft.items.findIndex((entry) => !(entry.itemKey in draft.answers));
    this.index = firstOpen === -1 ? 0 : firstOpen;
    this.enteredAt = this.env.now();
    this.patch({
      phase: "running",
      index: this.index,
      remaining: remainingSeconds(draft.deadlineAt, this.offset ?? 0, this.env.now()),
      error: null,
    });
    this.startTicking();
  }

  async start(): Promise<void> {
    this.patch({ phase: "starting", error: null });
    if (this.knownDraft) {
      // «Продолжить тест»: сначала тот самый черновик. Если срок вышел, чтение завершает его
      // на сервере (§7.5), и виден итог этой попытки, а не новый тест с полным временем.
      let read: CscaTestAttempt;
      try {
        read = await readCscaTestAttemptV1(this.env.transport, this.knownDraft);
      } catch (error) {
        this.patch({ phase: "intro", error: cscaFailure(error) === "denied" ? "denied" : "unavailable" });
        return;
      }
      const receivedAt = this.env.now();
      this.knownDraft = null;
      if (read.status === "completed") return this.showResult(read);
      return this.run(read, receivedAt);
    }
    // Запрос старта замораживается один раз: повтор после обрыва идёт с тем же p_request_id.
    this.startWrite ??= startTestWrite(this.formId, this.env.newId());
    let attempt: CscaTestAttempt;
    try {
      attempt = await sendTestAttempt(this.env.transport, this.startWrite);
    } catch (error) {
      this.patch({ phase: "intro", error: cscaFailure(error) === "denied" ? "denied" : "unavailable" });
      return;
    }
    const receivedAt = this.env.now();
    this.startWrite = null;
    // Сервер отдаёт завершённую попытку, если черновик формы истёк (§7.1).
    if (attempt.status === "completed") return this.showResult(attempt);
    this.run(attempt, receivedAt);
  }

  /** «Пройти ещё раз»: снова вступление, новая попытка. */
  restart(): void {
    this.attempt = null;
    this.revision = 0;
    this.offset = null;
    this.answers = {};
    this.flags = [];
    this.seconds = {};
    this.sentSeconds = {};
    this.dirty = false;
    this.retry = null;
    this.enteredAt = null;
    this.index = 0;
    this.startWrite = null;
    this.knownDraft = null;
    this.stopTicking();
    this.patch({ attempt: null, answers: {}, flags: [], index: 0, remaining: null, saveStatus: "idle", error: null, notice: null, phase: "intro", lastMinute: false });
  }

  // ---- ввод ------------------------------------------------------------------------------
  select(itemKey: string, option: CscaOptionId): void {
    if (this.state.phase !== "running") return;
    this.answers = { ...this.answers, [itemKey]: option };
    this.touched.add(itemKey);
    this.patch({ answers: { ...this.answers } });
    this.scheduleSave();
  }

  toggleFlag(itemKey: string): void {
    if (this.state.phase !== "running") return;
    this.flags = this.flags.includes(itemKey) ? this.flags.filter((k) => k !== itemKey) : [...this.flags, itemKey];
    this.flagsTouched = true;
    this.flagsVersion += 1;
    this.patch({ flags: [...this.flags] });
    this.scheduleSave();
  }

  goTo(next: number): void {
    const attempt = this.attempt;
    if (!attempt || this.state.phase !== "running") return;
    const clamped = Math.min(Math.max(0, next), attempt.items.length - 1);
    if (clamped === this.index) return;
    this.settleSeconds();
    this.index = clamped;
    this.enteredAt = this.visible ? this.env.now() : null;
    this.patch({ index: clamped });
    // Время на задании сохраняется при переходе, не чаще раза в 2 с.
    this.dirty = this.dirty || itemSecondsChanged(attempt.items, this.seconds, this.sentSeconds);
    if (this.dirty) this.scheduleSave(SAVE_ON_MOVE_MS);
  }

  /** Экран в фон: сохранить сразу; время задания не копится, пока приложение не видно. */
  onBackground(): void {
    if (this.state.phase !== "running") return;
    this.settleSeconds();
    this.enteredAt = null;
    this.visible = false;
    void this.flush({ settle: true });
  }

  onForeground(): void {
    this.visible = true;
    if (this.state.phase === "running") {
      this.enteredAt = this.env.now();
      this.tick();
      // После сна устройства монотонные часы могли встать: сверяем отсчёт с сервером (§7.2).
      void this.resyncClock();
    }
  }

  /**
   * Свежий serverNow по чтению попытки. Ответы и флажки на экране не трогаются (там могут быть
   * ещё не отправленные выборы); отсчёт назад не переводится; завершённая другим путём попытка
   * показывает итог.
   */
  async resyncClock(): Promise<void> {
    const current = this.attempt;
    if (!current || current.status !== "draft") return;
    let fresh: CscaTestAttempt;
    try {
      fresh = await readCscaTestAttemptV1(this.env.transport, current.attemptId);
    } catch {
      return; // нет связи: остаётся прежняя оценка, она не хуже
    }
    const receivedAt = this.env.now();
    if (this.disposed || this.attempt?.attemptId !== current.attemptId) return;
    if (fresh.status === "completed") return this.showResult(fresh);
    this.offset = laterClockOffset(this.offset, clockOffsetMs(fresh.serverNow, receivedAt));
    this.tick();
  }

  // ---- сохранение ------------------------------------------------------------------------
  /** Выбор: статус «Сохраняем…», отправка через 1,5 с, не раньше 2 с после прошлой (§7.3). */
  private scheduleSave(minDelay = SAVE_ON_CHOICE_MS): void {
    this.dirty = true;
    if (this.retry) return; // таймер повтора не сбивается
    this.patch({ saveStatus: "pending" });
    if (this.batchTimer) this.env.clearTimer(this.batchTimer);
    const sinceLast = this.env.now() - this.lastSaveAt;
    this.batchTimer = this.env.setTimer(() => {
      this.batchTimer = null;
      void this.flush();
    }, Math.max(minDelay, SAVE_ON_MOVE_MS - sinceLast));
  }

  async flush(options: { settle?: boolean } = {}): Promise<void> {
    while (this.saving) await this.saving;
    const current = this.attempt;
    if (!current || current.status !== "draft") return;
    if (options.settle) {
      this.settleSeconds();
      if (itemSecondsChanged(current.items, this.seconds, this.sentSeconds)) this.dirty = true;
    }
    if (!this.dirty && !this.retry) return;
    if (this.batchTimer) {
      this.env.clearTimer(this.batchTimer);
      this.batchTimer = null;
    }
    const run = this.sendOnce(current);
    this.saving = run;
    try {
      await run;
    } finally {
      if (this.saving === run) this.saving = null;
    }
    if (this.dirty && !this.retry && !this.disposed) await this.flush();
  }

  private async sendOnce(current: CscaTestAttempt): Promise<void> {
    let request = this.retry;
    if (!request) {
      this.settleSeconds();
      const payload = testSavePayload(current.items, this.answers, this.flags, this.seconds);
      request = {
        expectedRevision: this.revision,
        itemSeconds: payload.itemSeconds,
        sentAnswers: payload.answers,
        flagsVersion: this.flagsVersion,
        // Запрос замораживается здесь: id, ревизия и тело дальше не меняются.
        write: saveTestWrite({ attemptId: current.attemptId, expectedRevision: this.revision, ...payload }, this.env.newId()),
      };
      this.sentSeconds = payload.itemSeconds;
      this.dirty = false;
    }
    this.patch({ saveStatus: "saving" });
    let receipt;
    try {
      receipt = await sendTestSave(this.env.transport, request.write);
    } catch (error) {
      const code = cscaFailure(error);
      this.lastSaveAt = this.env.now();
      if (code === "unavailable") {
        // Тот же запрос: сервер мог его уже принять, повтор вернёт ту же квитанцию.
        this.retry = request;
        this.patch({ saveStatus: "retrying" });
        this.batchTimer = this.env.setTimer(() => void this.flush(), RETRY_MS);
        return;
      }
      this.retry = null;
      if (code === "conflict") {
        // Попытка изменилась (другое устройство): сервер главнее для сохранённого, но выборы,
        // сделанные здесь и не подтверждённые, накладываются поверх и уходят следующим запросом.
        const localAnswers = { ...this.answers };
        const localFlags = [...this.flags];
        const keys = [...this.touched];
        const flagsTouched = this.flagsTouched;
        this.patch({ notice: "conflict" });
        await this.reloadAttempt();
        if (this.attempt?.status === "draft" && this.state.phase === "running" && (keys.length > 0 || flagsTouched)) {
          for (const key of keys) {
            this.answers[key] = localAnswers[key];
            this.touched.add(key);
          }
          if (flagsTouched) {
            this.flags = localFlags;
            this.flagsTouched = true;
          }
          this.patch({ answers: { ...this.answers }, flags: [...this.flags] });
          this.scheduleSave();
          return;
        }
        this.patch({ saveStatus: "saved" });
        return;
      }
      if (code === "test_completed") {
        this.patch({ saveStatus: "idle" });
        await this.reloadAttempt();
        return;
      }
      if (code === "deadline_passed") {
        // Срок держит сервер: завершаем тем, что сохранено до срока.
        this.patch({ saveStatus: "idle" });
        void this.finalize();
        return;
      }
      this.patch({ saveStatus: "idle", error: code === "denied" ? "denied" : "invalid" });
      return;
    }
    const receivedAt = this.env.now();
    this.lastSaveAt = receivedAt;
    this.retry = null;
    // Подтверждено только то, что ушло и не менялось за время запроса.
    for (const [key, sent] of Object.entries(request.sentAnswers)) if (this.answers[key] === sent) this.touched.delete(key);
    if (this.flagsVersion === request.flagsVersion) this.flagsTouched = false;
    this.revision = receipt.revision;
    // По квитанции отсчёт назад не переводится (§7.2).
    this.offset = laterClockOffset(this.offset, clockOffsetMs(receipt.serverNow, receivedAt));
    // Пока шёл запрос, ученик мог выбрать ещё: тогда «Сохранено» неправда.
    this.patch({ saveStatus: this.dirty ? "saving" : "saved", notice: null });
  }

  // ---- завершение ------------------------------------------------------------------------
  async finalize(): Promise<void> {
    if (this.finalizing) return;
    const current = this.attempt;
    if (!current) return;
    this.finalizing = true;
    this.patch({ phase: "finishing", error: null });
    try {
      // Сначала несохранённое (§7.4): повтор после сбоя, текущее состояние и время на задании.
      for (;;) {
        await this.flush({ settle: true });
        const latest = this.attempt;
        if (!latest || latest.status !== "draft") return;
        if (!this.dirty && !this.retry) break;
        const now = this.env.now();
        const offset = this.offset ?? 0;
        if (!serverAcceptsSave(latest.deadlineAt, latest.graceSeconds, offset, now)) break;
        if (remainingSeconds(latest.deadlineAt, offset, now) > 0) {
          // Досрочно и без связи: назад к заданиям, сохранение повторится само.
          this.patch({ notice: "finishUnsent", phase: "running" });
          return;
        }
        await this.env.wait(RETRY_MS); // время вышло, запас идёт: повторяем отправку
      }
      let complete = completeTestWrite({ attemptId: current.attemptId, expectedRevision: this.revision }, this.env.newId());
      let completeRevision = this.revision;
      for (let n = 0; n < 12; n += 1) {
        if (completeRevision !== this.revision) {
          completeRevision = this.revision;
          complete = completeTestWrite({ attemptId: current.attemptId, expectedRevision: this.revision }, this.env.newId());
        }
        try {
          const done = await sendTestAttempt(this.env.transport, complete);
          return this.showResult(done);
        } catch (error) {
          const code = cscaFailure(error);
          if (code === "conflict" || code === "test_completed") {
            const fresh = await this.reloadAttempt();
            if (fresh?.status === "completed") return;
            continue;
          }
          if (code === "early_finish_forbidden" || code === "unavailable") {
            // Часы клиента чуть впереди сервера или нет сети: срок держит сервер.
            await this.env.wait(code === "unavailable" ? RETRY_MS : 1_500);
            continue;
          }
          this.patch({ error: code === "denied" ? "denied" : "invalid", phase: "running" });
          return;
        }
      }
      this.patch({ error: "unavailable", phase: "running" });
    } finally {
      this.finalizing = false;
    }
  }

  // ---- часы ------------------------------------------------------------------------------
  /** Отсчёт только отображение; срок держит сервер. */
  tick(): void {
    const current = this.attempt;
    if (!current || current.status !== "draft") return;
    const left = remainingSeconds(current.deadlineAt, this.offset ?? 0, this.env.now());
    this.patch({ remaining: left, lastMinute: left <= 60 && left > 0 });
    if (left === 0 && this.state.phase === "running") void this.finalize();
  }

  private startTicking(): void {
    this.stopTicking();
    const loop = () => {
      this.tick();
      this.tickTimer = this.env.setTimer(loop, 500);
    };
    loop();
  }
  private stopTicking(): void {
    if (this.tickTimer) this.env.clearTimer(this.tickTimer);
    this.tickTimer = null;
  }
}
