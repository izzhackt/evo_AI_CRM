// Синтетические попытки тестов (english36, orvis92) в форме строгого разборщика и поддельная среда сессии с ручными
// таймерами. Тексты придуманы, настоящего содержания тестов здесь нет.
import type { AssessmentEnv } from "@/features/learning/tests/assessment-session";
import type { RpcTransport } from "@/lib/rpc";

export const ATTEMPT_ID = "11111111-1111-4111-8111-111111111111";
export const VERSION_ID = "22222222-2222-4222-8222-222222222222";
export const OTHER_ATTEMPT_ID = "33333333-3333-4333-8333-333333333333";

export type FixtureKey = "english36" | "orvis92";

const SCALE_LABELS = ["Совсем не нравится", "Скорее не нравится", "Ни нравится, ни не нравится", "Скорее нравится", "Очень нравится"];

export function questionsFor(key: FixtureKey, count?: number) {
  if (key === "orvis92") {
    return Array.from({ length: count ?? 92 }, (_, i) => ({
      id: `o${i + 1}`,
      prompt: `Утверждение ${i + 1}`,
      options: SCALE_LABELS.map((label, k) => ({ id: String(k + 1), label })),
    }));
  }
  return Array.from({ length: count ?? 36 }, (_, i) => ({
    id: `e${i + 1}`,
    prompt: `Choose the word ${i + 1}`,
    options: [
      { id: "a", label: "alpha" },
      { id: "b", label: "beta" },
      { id: "unknown", label: "Не знаю" },
    ],
    topic: "grammar",
    ...(i % 3 === 0 ? { passage: `Passage ${i + 1}` } : {}),
  }));
}

/** Ответы на первые `n` вопросов (первый вариант каждого). */
export function answersFor(key: FixtureKey, n: number, count?: number): Record<string, string> {
  return Object.fromEntries(questionsFor(key, count).slice(0, n).map((q) => [q.id, q.options[0].id]));
}

export function attemptFixture(key: FixtureKey, overrides: Record<string, unknown> = {}, count?: number) {
  const career = key === "orvis92";
  return {
    attemptId: ATTEMPT_ID,
    instrumentKey: key,
    versionId: VERSION_ID,
    version: "1.0.0",
    locale: "ru",
    status: "draft",
    revision: 1,
    metadata: { title: career ? "Профориентация" : "Английский", description: "Описание теста", instructions: ["Инструкция один"], limitations: ["Ограничение один"] },
    questions: questionsFor(key, count),
    answers: {},
    result: null,
    createdAt: "2026-11-09T10:00:00+00:00",
    updatedAt: "2026-11-09T10:00:00+00:00",
    completedAt: null,
    ...overrides,
  };
}

/** Каталог с одним инструментом: черновик (`draft`) или последний завершённый (`completed`) по желанию. */
export function catalogFixture(key: FixtureKey, opts: { draft?: string | null; completed?: string | null; questionCount?: number; attempts?: unknown[] } = {}) {
  return {
    instruments: [
      {
        instrumentKey: key,
        versionId: VERSION_ID,
        version: "1.0.0",
        locale: "ru",
        metadata: { title: key === "orvis92" ? "Профориентация" : "Английский", description: "Описание теста", instructions: ["Инструкция один", "Инструкция два"], limitations: ["Ограничение один"] },
        questionCount: opts.questionCount ?? (key === "orvis92" ? 92 : 36),
        draftAttemptId: opts.draft ?? null,
        latestCompletedAttemptId: opts.completed ?? null,
      },
    ],
    attempts: opts.attempts ?? [],
  };
}

type Replies = Record<string, unknown[]>;

/**
 * Среда сессии без сети и без настоящих таймеров: ответы по имени RPC по очереди (последний повторяется), `NETWORK` -
 * обрыв, `CONFLICT` - конфликт ревизии; `advance(ms)` двигает время и ждёт цепочки обещаний.
 */
export function sessionHarness(replies: Replies) {
  let now = 0;
  let next = 1;
  let id = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const transport: RpcTransport = async (name, args) => {
    calls.push({ name, args: { ...(args ?? {}) } });
    const queue = replies[name];
    const reply = queue && queue.length > 1 ? queue.shift() : queue?.[0];
    if (reply === "NETWORK") return { data: null, error: { code: null, message: "net" }, status: null };
    if (reply === "CONFLICT") return { data: null, error: { code: "40001", message: "Learning attempt changed" }, status: 409 };
    if (reply === "DENIED") return { data: null, error: { code: "42501", message: "denied" }, status: 403 };
    return { data: reply, error: null, status: 200 };
  };
  const env: AssessmentEnv = {
    transport,
    setTimer: (fn, ms) => {
      const handle = next++;
      timers.set(handle, { at: now + ms, fn });
      return handle;
    },
    clearTimer: (handle) => void timers.delete(handle as number),
    newId: () => `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}`,
  };
  async function settle() {
    for (let i = 0; i < 40; i += 1) await Promise.resolve();
  }
  async function advance(ms: number) {
    const target = now + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      now = Math.max(now, due[1].at);
      timers.delete(due[0]);
      due[1].fn();
      await settle();
    }
    now = target;
    await settle();
  }
  return { env, calls, advance, settle, pendingTimers: () => timers.size };
}
