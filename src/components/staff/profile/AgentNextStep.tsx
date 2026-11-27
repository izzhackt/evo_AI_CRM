"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";

import type { AgentSuggestion } from "@/lib/agent-suggestions-contract";
import { decideAgentSuggestionAction, type AgentSuggestionActionState } from "@/lib/platform-agent-suggestions-actions";
import { agentSuggestionOutcome, agentSuggestionWords as words } from "@/lib/v3/wording";

import { AgentSuggestionRow } from "./AgentSuggestionRow";
import { useAgentWork } from "./use-agent-work";

/** Текстовая кнопка факта (как «Задать шаг»): 44 px по высоте, подчёркнута. */
const FACT_ACTION = "inline-flex min-h-11 items-center t-label text-fg-2 underline underline-offset-4 hover:text-fg disabled:cursor-wait disabled:no-underline disabled:text-fg-3";

export type AgentNextStepProps = Readonly<{
  studentCaseId: string;
  /** Нет записанного шага: только тогда строка предлагает шаг. */
  noStep: boolean;
  /** Держатель записи шага (тот же `nextStepAccess`) и строка очереди с версией дела. */
  editable: boolean;
  version: string | null;
  suggestion: AgentSuggestion | null;
  today: string;
  requestId: string;
  /** Шаг записан «Принять»: строка шага берёт квитанцию и id РЕШЕНИЯ (не запуска агента). */
  onAccepted: (receipt: NonNullable<AgentSuggestionActionState["receipt"]>, decisionRequestId: string) => void;
}>;

/**
 * «Предложить шаг» и предложение агента под «Шаг не задан» (миграция 383, решение владельца 28.11.2026). Агент работает
 * только по кнопке и сам ничего не записывает: показанное предложение — его слова, а «Принять» пишет шаг существующей
 * записью шага дела от имени сотрудника (с версией дела, которую он видит; устаревшая версия — конфликт, предложение
 * остаётся). Пока агент работает — «Агент думает…», страница опрашивает запуск и сама подхватывает предложение.
 */
export function AgentNextStep(props: AgentNextStepProps) {
  const { studentCaseId, noStep, editable, version, suggestion, today, onAccepted } = props;
  const router = useRouter();
  const work = useAgentWork({ kind: "next_step", studentCaseId, requestId: props.requestId });
  const [decideRequestId, setDecideRequestId] = useState<string | null>(null);
  const [busy, setBusy] = useState<"accept" | "dismiss" | null>(null);
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const [feedback, setFeedback] = useState<Readonly<{ tone: "ok" | "danger"; text: string }> | null>(null);
  // Предложение, на которое сотрудник уже ответил: до перечитывания страницы оно не показывается.
  const [decidedId, setDecidedId] = useState<string | null>(null);
  const lock = useRef(false);

  // Пришло новое предложение — прежний ответ к нему не относится (как версия дела в `CaseNextStep`).
  const [seenId, setSeenId] = useState(suggestion?.id ?? null);
  if ((suggestion?.id ?? null) !== seenId) {
    setSeenId(suggestion?.id ?? null);
    if (suggestion) { setFeedback(null); work.reset(); }
  }

  async function decide(decision: "accept" | "dismiss", event?: FormEvent) {
    event?.preventDefault();
    if (!suggestion || lock.current || (decision === "accept" && version === null)) return;
    lock.current = true;
    setBusy(decision);
    setFeedback(null);
    const id = decideRequestId ?? crypto.randomUUID();
    setDecideRequestId(id);
    try {
      const form = new FormData();
      form.set("suggestion_id", suggestion.id);
      form.set("student_case_id", studentCaseId);
      form.set("decision", decision);
      form.set("expected_version", decision === "accept" ? version ?? "" : "");
      form.set("dismiss_reason", decision === "dismiss" ? reason : "");
      form.set("request_id", id);
      const state = await decideAgentSuggestionAction({ status: "idle", requestId: id, message: null, receipt: null }, form);
      if (state.status === "accepted" || state.status === "dismissed") {
        setDecidedId(suggestion.id);
        setDecideRequestId(null);
        setAsking(false);
        setReason("");
        if (state.status === "accepted" && state.receipt) onAccepted(state.receipt, id);
        setFeedback({ tone: "ok", text: state.message ?? "" });
        router.refresh();
      } else {
        // Неизвестный исход повторяется тем же id (шаг не запишется дважды); остальное — свежим.
        setDecideRequestId(state.status === "unavailable" ? id : null);
        setFeedback({ tone: "danger", text: state.message ?? "" });
        if (state.status === "stale" || state.status === "gone") router.refresh();
      }
    } catch {
      setFeedback({ tone: "danger", text: agentSuggestionOutcome("unavailable") ?? "" });
    } finally {
      lock.current = false;
      setBusy(null);
    }
  }

  const shown = noStep && suggestion !== null && suggestion.id !== decidedId ? suggestion : null;
  const { phase, busy: running } = work;
  if (!editable && !shown && !feedback) return null;
  if (!noStep && !feedback) return null;

  return (
    <div className="flex flex-col gap-1" data-testid="v3-agent-next-step">
      {shown ? (
        <AgentSuggestionRow suggestion={shown} today={today} editable={editable} version={version} busy={busy} asking={asking} reason={reason}
          onReason={setReason} onAsk={setAsking} onAccept={() => void decide("accept")} onDismiss={(event) => void decide("dismiss", event)} />
      ) : editable && noStep ? (
        running ? (
          <p role="status" className="inline-flex min-h-11 items-center t-body-compact text-fg-2" data-testid="v3-agent-thinking">
            {phase.kind === "starting" ? words.starting : words.thinking}
          </p>
        ) : (
          <p className="flex flex-wrap items-baseline gap-x-3">
            <button type="button" onClick={() => void work.ask()} disabled={running} className={FACT_ACTION} data-testid="v3-agent-suggest">{words.suggest}</button>
            {phase.kind === "finished" && !work.refreshing && !shown ? <span className="t-body-compact text-fg-2" data-testid="v3-agent-none">{words.noProposal}</span> : null}
            {phase.kind === "slow" ? <span className="t-body-compact text-fg-2">{words.stillWorking}</span> : null}
            {phase.kind === "lost" ? <span className="t-body-compact text-fg-2" data-testid="v3-agent-lost">{words.pollLost}</span> : null}
          </p>
        )
      ) : null}
      {phase.kind === "failed" ? <p role="alert" className="t-body-compact text-danger" data-testid="v3-agent-failed">{phase.message}</p> : null}
      {feedback ? (
        <p role={feedback.tone === "ok" ? "status" : "alert"} className={`t-body-compact ${feedback.tone === "ok" ? "text-ok" : "text-danger"}`}>{feedback.text}</p>
      ) : null}
    </div>
  );
}
