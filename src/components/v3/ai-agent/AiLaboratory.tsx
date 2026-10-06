"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";

import { Icon } from "@/components/icons";
import { btnCls } from "@/components/ui";
import { StatusChip } from "@/components/v3/blocks/StatusChip";
import { QUEUE_CONFIRM } from "@/components/v3/queue/queue-buttons";
import { discardAiLabAction, rejectAiLabProposalAction, type AiActionState } from "@/lib/platform-ai-agent-actions";
import {
  AUDIENCE_LABEL,
  aiAgentHref,
  aiErrorCopy,
  answerWarnings,
  replySegments,
  sourcePlace,
  sourcesWord,
  type AiAnswerResult,
  type AiSource,
} from "@/lib/v3/ai-agent";
import {
  AI_LAB_ERROR_COPY,
  AI_LAB_KIND_LABEL,
  AI_LAB_TEXT_LIMIT,
  createSseDecoder,
  isAiLabText,
  normalizeAiLabState,
  parseAiLabStreamEvent,
  type AiLabProposal,
  type AiLabState,
} from "@/lib/v3/ai-agent-knowledge";

/**
 * «Лаборатория» (план §8): сотрудник спрашивает как клиент и видит ответ с
 * источниками и «Почему такой ответ» (тот же конвейер, что в чате; в журнале —
 * `laboratory`), пишет «Что не так?», агент предлагает ОДНО изменение —
 * «Было/Стало» в тексте документа, новый фрагмент, правку «Правил общения»
 * или пример — и эталонный ответ. «Применить» перепроверяет знания и
 * предложение в одной транзакции (409 — «Знания или предложение изменились»),
 * «Не менять» ничего не трогает.
 *
 * Поток агента — живой предпросмотр; показывается всегда то, что записала
 * база (`GET /api/v3/ai-agent/lab`). Каждое открытие начинается с пустой
 * проверки, кроме неприменённого предложения: его не теряют перезагрузкой.
 */
type Phase =
  | Readonly<{ kind: "idle" }>
  | Readonly<{ kind: "asking"; stage: "searching" | "writing"; sources: number | null; preview: string }>
  | Readonly<{ kind: "critiquing"; preview: string }>
  | Readonly<{ kind: "applying" }>
  | Readonly<{ kind: "applied"; target: string }>
  | Readonly<{ kind: "rejected" }>
  | Readonly<{ kind: "no_change"; why: string }>
  | Readonly<{ kind: "error"; step: "ask" | "critique" | "apply" | "load" | "reset"; code: string; message: string }>;

function labError(code: string, message: string | null = null): string {
  return AI_LAB_ERROR_COPY[code] ?? aiErrorCopy(code, message);
}

async function errorCode(response: Response): Promise<string> {
  try {
    const body = await response.json() as { error?: { code?: unknown } };
    return typeof body.error?.code === "string" ? body.error.code : "unavailable";
  } catch {
    return "unavailable";
  }
}

function LabSource({ source, highlighted }: Readonly<{ source: AiSource; highlighted: boolean }>) {
  const place = sourcePlace(source);
  const page = source.pageFrom;
  return (
    <li data-source-n={source.n ?? undefined} data-highlighted={highlighted || undefined} className="v3-ai-source">
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="v3-ai-source-n" aria-hidden="true">{source.n ?? "·"}</span>
        <div className="min-w-0 flex-1">
          <p className="t-item break-words text-fg">
            <span className="sr-only">Источник {source.n}: </span>
            {source.missing ? "Документ удалён" : source.title}
            {place ? <span className="font-normal text-fg-3"> · {place}</span> : null}
          </p>
          {source.sectionPath && !source.missing ? <p className="t-meta break-words text-fg-3">{source.sectionPath}</p> : null}
          {source.quote ? <blockquote className="v3-ai-quote t-body-compact text-fg-2" data-clamped={!highlighted || undefined}>{source.quote}</blockquote> : null}
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            {source.audience === "internal" ? <StatusChip label="Внутреннее" tone="info" title="Клиенту не цитируется" /> : null}
            {source.unverified ? <StatusChip label="не проверено" tone="warn" /> : null}
            {!source.live && !source.missing ? <StatusChip label="документ заменён" tone="neutral" /> : null}
            {source.documentId && !source.missing ? (
              <Link
                href={aiAgentHref("documents", { document: source.documentId, page, chunk: source.chunkId })}
                className="inline-flex min-h-11 items-center t-label text-fg-2 underline underline-offset-4 hover:text-fg"
              >
                Открыть в документе
              </Link>
            ) : null}
          </div>
        </div>
      </div>
    </li>
  );
}

function LabAnswer({ result }: Readonly<{ result: AiAnswerResult }>) {
  const [highlight, setHighlight] = useState<number | null>(null);
  const warnings = answerWarnings(result);
  return (
    <div className="space-y-3" data-testid="v3-ai-lab-answer">
      <p className="whitespace-pre-wrap break-words t-body text-fg" data-testid="v3-ai-reply" lang={result.language ?? undefined}>
        {replySegments(result).map((segment, index) => (
          <span key={index}>
            {segment.text}
            {segment.marks.map((n) => (
              <button key={n} type="button" className="v3-ai-mark" aria-label={`Источник ${n}`} onClick={() => setHighlight(n)}>{n}</button>
            ))}
          </span>
        ))}
      </p>
      {warnings.length > 0 ? (
        <ul className="space-y-1.5" data-testid="v3-ai-warnings">
          {warnings.map((warning) => (
            <li key={warning} className="v3-ai-flag t-body-compact"><Icon name="alert" size={16} className="mt-0.5 shrink-0" />{warning}</li>
          ))}
        </ul>
      ) : null}
      {result.reason.trim() ? (
        <details className="v3-ai-why">
          <summary className="t-label text-fg">
            <Icon name="chevron-right" size={16} className="v3-ai-why-chevron shrink-0" />
            Почему такой ответ
          </summary>
          <p className="mt-1 whitespace-pre-wrap break-words t-body-compact text-fg-2">{result.reason}</p>
        </details>
      ) : null}
      {result.sources.length > 0 ? (
        <div>
          <h4 className="t-caption text-fg-3">Источники</h4>
          <ol className="mt-1.5 space-y-2" data-testid="v3-ai-sources">
            {result.sources.map((source, index) => (
              <LabSource key={`${source.n ?? "x"}-${index}`} source={source} highlighted={source.n !== null && source.n === highlight} />
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}

function targetLine(proposal: AiLabProposal): string {
  if (proposal.kind === "rules") return `«Правила общения»${proposal.target.rulesVersion !== null ? `, версия ${proposal.target.rulesVersion}` : ""}`;
  if (proposal.kind === "knowledge") return `${proposal.newTitle ? `новый документ «${proposal.newTitle}»` : "новый документ"}${proposal.audience ? ` · ${AUDIENCE_LABEL[proposal.audience]}` : ""}`;
  if (proposal.kind === "example") return "пример ответа";
  return `«${proposal.target.title ?? "документ"}»${proposal.target.docVersion !== null ? `, версия текста ${proposal.target.docVersion}` : ""}`;
}

function ProposalCard({
  proposal,
  canApply,
  phase,
  onApply,
  onReject,
  rejecting,
}: Readonly<{
  proposal: AiLabProposal;
  canApply: boolean;
  phase: Phase;
  onApply: () => void;
  onReject: () => void;
  rejecting: boolean;
}>) {
  const busy = phase.kind === "applying" || rejecting;
  return (
    <section aria-labelledby="ai-lab-proposal" className="v3-ai-proposal" data-testid="v3-ai-lab-proposal" data-kind={proposal.kind}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 id="ai-lab-proposal" className="t-section text-fg">{AI_LAB_KIND_LABEL[proposal.kind]}</h3>
        <p className="t-meta text-fg-3">{targetLine(proposal)}</p>
      </div>
      {proposal.why.trim() ? <p className="max-w-[72ch] t-body-compact text-fg-2">{proposal.why}</p> : null}
      <div className="grid gap-3 lg:grid-cols-2">
        {proposal.kind !== "knowledge" && proposal.kind !== "example" ? (
          <div className="min-w-0">
            <p className="t-caption text-fg-3">Было</p>
            <div className="v3-ai-diff" data-side="before">{proposal.before || <span className="text-fg-3">—</span>}</div>
          </div>
        ) : null}
        <div className={`min-w-0 ${proposal.kind === "knowledge" || proposal.kind === "example" ? "lg:col-span-2" : ""}`}>
          <p className="t-caption text-fg-3">{proposal.kind === "knowledge" ? "Новый фрагмент" : "Стало"}</p>
          <div className="v3-ai-diff" data-side="after">{proposal.after}</div>
        </div>
      </div>
      {proposal.answer.trim() ? (
        <div className="v3-ai-question">
          <p className="t-caption text-fg-3">Эталонный ответ</p>
          <p className="mt-0.5 pb-2 whitespace-pre-wrap break-words t-body-compact text-fg">{proposal.answer}</p>
        </div>
      ) : null}
      {canApply ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <button type="button" className={btnCls} onClick={onApply} disabled={busy} data-testid="v3-ai-lab-apply">
            {phase.kind === "applying" ? "Применяю…" : "Применить"}
          </button>
          <button type="button" onClick={onReject} disabled={busy} className="inline-flex min-h-11 items-center t-label text-fg-2 underline underline-offset-4 hover:text-fg disabled:text-fg-3">
            {rejecting ? "Отклоняю…" : "Не менять"}
          </button>
          <p className="t-meta text-fg-3">
            {proposal.kind === "document" ? "Меняется текст, по которому ищет агент, — не исходный файл." : "Пример станет образцом для похожих вопросов."}
          </p>
        </div>
      ) : (
        <p className="t-body-compact text-fg-3">Применяет сотрудник с правом управления «ИИ-агентом».</p>
      )}
    </section>
  );
}

export function AiLaboratory({
  initial,
  featureOn,
  preview,
  requestIds,
}: Readonly<{
  /** null — не удалось прочитать проверку. */
  initial: AiLabState | null;
  featureOn: boolean;
  preview: boolean;
  requestIds: Readonly<{ discard: string; reject: string }>;
}>) {
  const router = useRouter();
  const ids = useId();
  // Открытие — с пустой проверки; неприменённое предложение остаётся.
  const [lab, setLab] = useState<AiLabState | null>(() => initial && initial.proposal?.status === "proposed"
    ? initial : initial ? { ...initial, session: null, proposal: null } : null);
  const [question, setQuestion] = useState("");
  const [finding, setFinding] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [rejecting, setRejecting] = useState(false);
  const [discardId, setDiscardId] = useState(requestIds.discard);
  const [rejectId, setRejectId] = useState(requestIds.reject);
  const abortRef = useRef<AbortController | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const findingRef = useRef<HTMLTextAreaElement>(null);
  const questionRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => () => abortRef.current?.abort(), []);
  // Фокус — после того, как новый шаг уже на странице (а не до отрисовки).
  const focusNext = useRef<"question" | "finding" | "result" | null>(null);
  const setFocusNext = (target: "question" | "finding" | "result") => { focusNext.current = target; };
  useEffect(() => {
    const target = focusNext.current;
    if (!target) return;
    focusNext.current = null;
    (target === "question" ? questionRef : target === "finding" ? findingRef : resultRef).current?.focus();
  });

  const reload = useCallback(async (): Promise<AiLabState | null> => {
    try {
      const response = await fetch("/api/v3/ai-agent/lab", { cache: "no-store", credentials: "same-origin", headers: { Accept: "application/json" } });
      if (!response.ok) {
        const code = await errorCode(response);
        setPhase({ kind: "error", step: "load", code, message: labError(code) });
        return null;
      }
      const body = await response.json() as { state?: unknown };
      const state = normalizeAiLabState(body.state);
      setLab(state);
      return state;
    } catch {
      setPhase({ kind: "error", step: "load", code: "unavailable", message: labError("unavailable") });
      return null;
    }
  }, []);

  const stream = useCallback(async (
    path: "ask" | "critique",
    body: Readonly<Record<string, string>>,
    onFrame: (event: NonNullable<ReturnType<typeof parseAiLabStreamEvent>>) => boolean,
  ): Promise<void> => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const step = path === "ask" ? "ask" : "critique";
    let response: Response;
    try {
      response = await fetch(`/api/v3/ai-agent/lab/${path}`, {
        method: "POST", cache: "no-store", credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify(body), signal: controller.signal,
      });
    } catch {
      if (!controller.signal.aborted) setPhase({ kind: "error", step, code: "agent_unavailable", message: labError("agent_unavailable") });
      return;
    }
    if (!(response.headers.get("content-type") ?? "").startsWith("text/event-stream") || !response.body) {
      const code = await errorCode(response);
      if (!controller.signal.aborted) setPhase({ kind: "error", step, code, message: labError(code) });
      return;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const frames = createSseDecoder();
    let settled = false;
    try {
      while (!settled) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const frame of frames(decoder.decode(value, { stream: true }))) {
          const event = parseAiLabStreamEvent(frame.event, frame.data);
          if (!event || controller.signal.aborted) continue;
          if (event.type === "error") {
            settled = true;
            setPhase({ kind: "error", step, code: event.code, message: labError(event.code, event.message) });
            break;
          }
          if (onFrame(event)) { settled = true; break; }
        }
      }
    } catch {
      if (!controller.signal.aborted) {
        settled = true;
        setPhase({ kind: "error", step, code: "agent_unavailable", message: labError("agent_unavailable") });
      }
    } finally {
      reader.cancel().catch(() => undefined);
      if (abortRef.current === controller) abortRef.current = null;
    }
    if (!settled && !controller.signal.aborted) setPhase({ kind: "error", step, code: "agent_unavailable", message: labError("agent_unavailable") });
  }, []);

  const ask = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!isAiLabText(question)) { questionRef.current?.focus(); return; }
    const asked = question.trim();
    setLab((previous) => previous ? { ...previous, session: { revision: 0, question: asked, answer: null, finding: "", updatedAt: null, expiresAt: null }, proposal: null } : previous);
    setFinding("");
    setPhase({ kind: "asking", stage: "searching", sources: null, preview: "" });
    let finished = false;
    await stream("ask", { question: asked }, (frame) => {
      if (frame.type === "status") setPhase((previous) => previous.kind === "asking" ? { ...previous, stage: frame.stage } : previous);
      else if (frame.type === "sources") setPhase((previous) => previous.kind === "asking" ? { ...previous, sources: frame.count } : previous);
      else if (frame.type === "delta") setPhase((previous) => previous.kind === "asking" ? { ...previous, stage: "writing", preview: (previous.preview + frame.text).slice(0, 8000) } : previous);
      else if (frame.type === "final") { finished = true; return true; }
      return false;
    });
    if (!finished) return;
    const state = await reload();
    if (state?.session?.answer) {
      setPhase({ kind: "idle" });
      setQuestion("");
      setFocusNext("finding");
    } else if (state) {
      setPhase({ kind: "error", step: "ask", code: "unavailable", message: labError("unavailable") });
    }
  };

  const critique = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!isAiLabText(finding)) { findingRef.current?.focus(); return; }
    setPhase({ kind: "critiquing", preview: "" });
    let outcome: "proposal" | "no_change" | null = null;
    let why = "";
    await stream("critique", { finding: finding.trim() }, (frame) => {
      if (frame.type === "delta") setPhase((previous) => previous.kind === "critiquing" ? { kind: "critiquing", preview: (previous.preview + frame.text).slice(0, 8000) } : previous);
      else if (frame.type === "proposal" || frame.type === "final") { outcome = "proposal"; return true; }
      else if (frame.type === "no_change") { outcome = "no_change"; why = frame.why; return true; }
      return false;
    });
    if (outcome === "no_change") { setPhase({ kind: "no_change", why }); return; }
    if (outcome !== "proposal") return;
    const state = await reload();
    if (state?.proposal?.status === "proposed") {
      setPhase({ kind: "idle" });
      setFocusNext("result");
    } else if (state) {
      setPhase({ kind: "error", step: "critique", code: "unavailable", message: labError("unavailable") });
    }
  };

  const apply = async () => {
    const proposal = lab?.proposal;
    if (!proposal || phase.kind === "applying") return;
    setPhase({ kind: "applying" });
    try {
      const response = await fetch("/api/v3/ai-agent/lab/apply", {
        method: "POST", cache: "no-store", credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ proposalId: proposal.id }),
      });
      if (!response.ok) {
        const code = await errorCode(response);
        setPhase({ kind: "error", step: "apply", code, message: labError(code) });
        if (code === "lab_changed" || code === "lab_edit_invalid") void reload();
        return;
      }
      setPhase({ kind: "applied", target: targetLine(proposal) });
      setLab((previous) => previous ? { ...previous, proposal: { ...proposal, status: "applied" } } : previous);
      router.refresh();
    } catch {
      setPhase({ kind: "error", step: "apply", code: "unavailable", message: labError("unavailable") });
    }
    setFocusNext("result");
  };

  const command = async (
    action: (previous: AiActionState, form: FormData) => Promise<AiActionState>,
    fields: Readonly<Record<string, string>>,
  ): Promise<AiActionState["status"]> => {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    try {
      return (await action({ status: "idle", requestId: null }, form)).status;
    } catch {
      return "unavailable";
    }
  };

  const reject = async () => {
    const proposal = lab?.proposal;
    if (!proposal) return;
    setRejecting(true);
    const status = await command(rejectAiLabProposalAction, { request_id: rejectId, proposal_id: proposal.id });
    setRejecting(false);
    if (status === "saved" || status === "conflict" || status === "invalid") setRejectId(crypto.randomUUID());
    if (status === "saved") {
      setLab((previous) => previous ? { ...previous, proposal: null } : previous);
      setPhase({ kind: "rejected" });
    } else {
      setPhase({ kind: "error", step: "apply", code: status, message: status === "conflict" ? labError("lab_changed") : labError("unavailable") });
    }
  };

  const reset = async () => {
    abortRef.current?.abort();
    const status = await command(discardAiLabAction, { request_id: discardId });
    if (status === "saved" || status === "conflict" || status === "invalid") setDiscardId(crypto.randomUUID());
    if (status !== "saved" && status !== "conflict") {
      setPhase({ kind: "error", step: "reset", code: status, message: "Не удалось начать новую проверку. Повторите." });
      return;
    }
    setLab((previous) => previous ? { ...previous, session: null, proposal: null } : previous);
    setQuestion("");
    setFinding("");
    setPhase({ kind: "idle" });
    setFocusNext("question");
  };

  if (preview) {
    return <p className="rounded-card border border-border bg-surface px-4 py-4 t-body-compact text-fg-2" data-testid="v3-ai-lab-preview">В просмотре роли Лаборатория не вызывает агента.</p>;
  }
  if (!lab) {
    return (
      <p role="alert" className="t-body-compact text-fg-2" data-testid="v3-ai-unavailable">
        Не удалось загрузить Лабораторию.{" "}
        <a href={aiAgentHref("lab")} className="inline-flex min-h-11 items-center underline underline-offset-4">Повторить</a>
      </p>
    );
  }

  const session = lab.session;
  const answer = session?.answer ?? null;
  const proposal = lab.proposal?.status === "proposed" ? lab.proposal : null;
  const asking = phase.kind === "asking";
  const critiquing = phase.kind === "critiquing";
  const started = session !== null || asking;
  const finished = phase.kind === "applied" || phase.kind === "rejected" || phase.kind === "no_change";
  const errorAt = (step: string) => phase.kind === "error" && phase.step === step ? (
    <p role="alert" className="flex items-start gap-2 t-body-compact text-danger" data-testid="v3-ai-lab-error" data-code={phase.code}>
      <Icon name="alert" size={16} className="mt-0.5 shrink-0" />{phase.message}
    </p>
  ) : null;

  return (
    <section aria-labelledby="ai-lab-title" className="v3-ai-lab space-y-5" data-testid="v3-ai-lab" data-phase={phase.kind}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0 space-y-1">
          <h2 id="ai-lab-title" className="t-section text-fg">Проверка ответа</h2>
          <p className="max-w-[68ch] t-body-compact text-fg-2">
            Спросите так, как спросил бы клиент. Если ответ неверный — напишите, что не так: агент предложит одну правку, применяете её вы.
          </p>
        </div>
        {started || finished ? (
          <button type="button" onClick={() => void reset()} className="inline-flex min-h-11 items-center gap-1.5 t-label text-fg-2 underline underline-offset-4 hover:text-fg" data-testid="v3-ai-lab-reset">
            <Icon name="refresh" size={16} />
            Новая проверка
          </button>
        ) : null}
      </div>
      {errorAt("reset")}
      {!featureOn ? (
        <p className="flex items-start gap-2 rounded-card border border-border bg-surface px-4 py-3 t-body-compact text-fg-2" data-testid="v3-ai-lab-off">
          <Icon name="lock" size={16} className="mt-0.5 shrink-0" />
          ИИ-агент не подключён к CRM — Лаборатория не отвечает. Подключает администратор.
        </p>
      ) : null}
      {errorAt("load")}

      <ol className="v3-ai-lab-steps">
        <li className="v3-ai-lab-step" data-done={session?.question ? "" : undefined}>
          <h3 className="t-label text-fg">Спросите как клиент</h3>
          {session?.question ? (
            <p className="v3-ai-lab-quote whitespace-pre-wrap break-words t-body-compact text-fg" data-testid="v3-ai-lab-question">{session.question}</p>
          ) : (
            <form onSubmit={(event) => void ask(event)} className="mt-2 space-y-2">
              <label htmlFor={`${ids}-question`} className="sr-only">Вопрос клиента</label>
              <textarea
                ref={questionRef}
                id={`${ids}-question`}
                rows={3}
                maxLength={AI_LAB_TEXT_LIMIT}
                value={question}
                onChange={(event) => setQuestion(event.currentTarget.value)}
                onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void ask(); }}
                placeholder="Например: сколько стоит бакалавриат в Малайзии и можно ли без IELTS?"
                className="w-full min-w-0 resize-y rounded-ctl border border-control-edge bg-surface px-3 py-2.5 t-body text-fg placeholder:text-fg-3 focus-visible:border-accent"
                disabled={!featureOn || asking}
                data-testid="v3-ai-lab-question-input"
              />
              <div className="flex flex-wrap items-center gap-3">
                <button type="submit" className={btnCls} disabled={!featureOn || asking} aria-disabled={!isAiLabText(question) || undefined} data-testid="v3-ai-lab-ask">
                  {asking ? "Готовлю ответ…" : "Спросить"}
                </button>
                <span className="t-meta text-fg-3">Ctrl + Enter</span>
              </div>
            </form>
          )}
          {errorAt("ask")}
        </li>

        {asking || answer ? (
          <li className="v3-ai-lab-step" data-done={answer ? "" : undefined}>
            <h3 className="t-label text-fg">Ответ агента</h3>
            {phase.kind === "asking" ? (
              <div className="mt-2 space-y-2" aria-busy="true">
                <p className="v3-ai-status t-meta" role="status">
                  <span className="v3-ai-dot" data-tone="working" aria-hidden="true" />
                  {phase.stage === "searching" ? "Ищу в материалах…" : `Пишу ответ…${phase.sources !== null ? ` · ${sourcesWord(phase.sources)}` : ""}`}
                </p>
                {phase.preview ? (
                  <p className="whitespace-pre-wrap break-words t-body text-fg" data-testid="v3-ai-preview">{phase.preview}<span className="v3-ai-caret" aria-hidden="true" /></p>
                ) : (
                  <div className="space-y-2" aria-hidden="true">
                    <div className="v3-ai-skeleton w-[92%]" /><div className="v3-ai-skeleton w-[78%]" /><div className="v3-ai-skeleton w-[54%]" />
                  </div>
                )}
              </div>
            ) : answer ? <div className="mt-2"><LabAnswer result={answer} /></div> : null}
          </li>
        ) : null}

        {answer && !asking ? (
          <li className="v3-ai-lab-step" data-done={proposal || finished ? "" : undefined}>
            <h3 className="t-label text-fg"><label htmlFor={`${ids}-finding`}>Что не так?</label></h3>
            {proposal || finished || critiquing ? (
              finding.trim() || session?.finding ? (
                <p className="v3-ai-lab-quote whitespace-pre-wrap break-words t-body-compact text-fg">{finding.trim() || session?.finding}</p>
              ) : null
            ) : (
              <form onSubmit={(event) => void critique(event)} className="mt-2 space-y-2">
                <textarea
                  ref={findingRef}
                  id={`${ids}-finding`}
                  rows={3}
                  maxLength={AI_LAB_TEXT_LIMIT}
                  value={finding}
                  onChange={(event) => setFinding(event.currentTarget.value)}
                  onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void critique(); }}
                  placeholder="Например: цена устарела — с 2027 года бакалавриат стоит от 6 000 $; или: слишком сухо, нужно предложить созвон."
                  className="w-full min-w-0 resize-y rounded-ctl border border-control-edge bg-surface px-3 py-2.5 t-body text-fg placeholder:text-fg-3 focus-visible:border-accent"
                  disabled={!featureOn}
                  data-testid="v3-ai-lab-finding"
                />
                <div className="flex flex-wrap items-center gap-3">
                  <button type="submit" className={QUEUE_CONFIRM} disabled={!featureOn} aria-disabled={!isAiLabText(finding) || undefined} data-testid="v3-ai-lab-critique">
                    Предложить правку
                  </button>
                  <span className="t-meta text-fg-3">Ответ верный? Начните новую проверку.</span>
                </div>
              </form>
            )}
            {phase.kind === "critiquing" ? (
              <div className="mt-2 space-y-2" aria-busy="true">
                <p className="v3-ai-status t-meta" role="status"><span className="v3-ai-dot" data-tone="working" aria-hidden="true" />Ищу, что поправить…</p>
                {phase.preview ? <p className="whitespace-pre-wrap break-words t-body-compact text-fg-2">{phase.preview}<span className="v3-ai-caret" aria-hidden="true" /></p> : null}
              </div>
            ) : null}
            {errorAt("critique")}
          </li>
        ) : null}
      </ol>

      <div ref={resultRef} tabIndex={-1} className="space-y-3 outline-none" aria-live="polite">
        {proposal && phase.kind !== "applied" ? (
          <ProposalCard
            proposal={proposal}
            canApply={lab.canManage && featureOn}
            phase={phase}
            onApply={() => void apply()}
            onReject={() => void reject()}
            rejecting={rejecting}
          />
        ) : null}
        {errorAt("apply")}
        {phase.kind === "applied" ? (
          <p role="status" className="flex items-start gap-2 t-body-compact text-ok" data-testid="v3-ai-lab-applied">
            <Icon name="circle-check" size={16} className="mt-0.5 shrink-0" />
            Применено: {phase.target}. Новый текст уже ищется, эталонный ответ сохранён.
          </p>
        ) : null}
        {phase.kind === "rejected" ? <p role="status" className="t-body-compact text-fg-2">Ничего не изменено.</p> : null}
        {phase.kind === "no_change" ? (
          <p role="status" className="t-body-compact text-fg-2" data-testid="v3-ai-lab-no-change">
            Менять нечего{phase.why ? `: ${phase.why}` : "."}
          </p>
        ) : null}
        {finished || (phase.kind === "error" && phase.step === "apply" && (phase.code === "lab_changed" || phase.code === "lab_edit_invalid")) ? (
          <button type="button" onClick={() => void reset()} className={QUEUE_CONFIRM}>Новая проверка</button>
        ) : null}
      </div>
    </section>
  );
}
