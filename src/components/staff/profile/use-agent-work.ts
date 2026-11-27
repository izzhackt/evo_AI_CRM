"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { pollAgentWorkAction, requestAgentWorkAction } from "@/lib/platform-agent-suggestions-actions";
import { agentSuggestionWords } from "@/lib/v3/wording";

const POLL_EVERY_MS = 3000;
/** Дольше этого «Агент думает…» не держится: агент мог ещё работать, страница скажет об этом честно. */
const POLL_LIMIT_MS = 180_000;

export type AgentWorkPhase =
  | Readonly<{ kind: "idle" }>
  | Readonly<{ kind: "starting" }>
  | Readonly<{ kind: "thinking"; runId: string }>
  | Readonly<{ kind: "lost" }>
  | Readonly<{ kind: "failed"; message: string }>
  | Readonly<{ kind: "finished" }>
  | Readonly<{ kind: "slow" }>;

/**
 * Поручение агенту-куратору по кнопке карточки дела («Предложить шаг», «Собрать передачу»): одно нажатие — один запуск
 * существующим путём «Поручить»; пока сессия идёт, раз в 3 секунды спрашиваем её состояние, конец — перечитать страницу.
 * Id запроса меняется после каждого ответа, кроме неизвестного исхода (запуск не задвоится). Отказ — слова из `wording.ts`.
 */
export function useAgentWork(input: Readonly<{
  kind: "next_step" | "handoff";
  studentCaseId: string;
  requestId: string;
}>) {
  const router = useRouter();
  // Перечитывание страницы после конца запуска: пока оно идёт, «ничего не появилось» ещё говорить рано.
  const [refreshing, startRefresh] = useTransition();
  const [phase, setPhase] = useState<AgentWorkPhase>({ kind: "idle" });
  const [requestId, setRequestId] = useState(input.requestId);
  const lock = useRef(false);
  const startedAt = useRef(0);
  const misses = useRef(0);

  useEffect(() => {
    if (phase.kind !== "thinking") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      const poll = await pollAgentWorkAction(phase.runId).catch((): { state: "unavailable" } => ({ state: "unavailable" }));
      if (cancelled) return;
      // Три неответа подряд — честно «не знаем, чем кончилось», а не «агент ещё работает».
      misses.current = poll.state === "unavailable" ? misses.current + 1 : 0;
      if (misses.current >= 3) { setPhase({ kind: "lost" }); return; }
      if (poll.state === "done") { setPhase({ kind: "finished" }); startRefresh(() => router.refresh()); return; }
      if (poll.state === "failed") { setPhase({ kind: "failed", message: poll.message }); return; }
      if (Date.now() - startedAt.current > POLL_LIMIT_MS) { setPhase({ kind: "slow" }); startRefresh(() => router.refresh()); return; }
      timer = setTimeout(tick, POLL_EVERY_MS);
    };
    timer = setTimeout(tick, POLL_EVERY_MS);
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [phase, router]);

  async function ask() {
    if (lock.current) return;
    lock.current = true;
    misses.current = 0;
    // Сразу «Запускаем агента…» и кнопка недоступна: второй запуск не начнётся, пока первый не ответил.
    setPhase({ kind: "starting" });
    try {
      const form = new FormData();
      form.set("student_case_id", input.studentCaseId);
      form.set("kind", input.kind);
      form.set("request_id", requestId);
      const state = await requestAgentWorkAction({ status: "idle", requestId, message: null, runId: null }, form);
      setRequestId(state.requestId);
      if (state.status === "started" && state.runId) {
        startedAt.current = Date.now();
        setPhase({ kind: "thinking", runId: state.runId });
      } else {
        setPhase({ kind: "failed", message: state.message ?? agentSuggestionWords.noProposal });
      }
    } catch {
      setPhase({ kind: "failed", message: agentSuggestionWords.noProposal });
    } finally {
      lock.current = false;
    }
  }

  const reset = () => setPhase({ kind: "idle" });
  return { phase, ask, reset, refreshing, busy: phase.kind === "starting" || phase.kind === "thinking" } as const;
}
