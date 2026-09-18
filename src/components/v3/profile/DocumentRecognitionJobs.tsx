"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import type { DocumentRecognitionJob, DocumentRecognitionRequest } from "@/lib/document-recognition";
import { DocumentRecognitionClientError, readRecognitionHistory, submitRecognitionRequest,
  type RecognitionHistoryPage } from "@/lib/document-recognition-client";
import { documentRecognitionCopy as copy, documentRecognitionState, documentRecognitionCleanup,
  documentRecognitionError } from "@/lib/v3/wording";
import type { DocumentRecognitionAccess } from "./document-types";

const button = "min-h-11 rounded-ctl border border-border px-3 py-2 text-sm text-fg disabled:cursor-not-allowed disabled:opacity-60";
const retryable = (job: DocumentRecognitionJob) => ["failed", "generation_unknown", "cancelled", "publication_blocked"].includes(job.state);
const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

export function DocumentRecognitionJobList({ jobs, reviewHref, canRetry, onRetry }: {
  jobs: readonly DocumentRecognitionJob[]; reviewHref: string; canRetry: boolean;
  onRetry(jobId: string): void;
}) {
  return <ul className="divide-y divide-border" aria-label={copy.title}>
    {jobs.map(job => <li key={job.job_id} className="space-y-1 py-3" data-testid="document-recognition-job" data-state={job.state}>
      <p className="text-sm font-medium">{documentRecognitionState(job.state)}</p>
      <p className="text-sm text-fg-2">{copy.cleanup}: {documentRecognitionCleanup(job.cleanup_state)}</p>
      {job.failure_code ? <p className="text-sm text-fg-2">{documentRecognitionError(job.failure_code)}</p> : null}
      {job.state === "review_ready" ? <p className="text-sm">{copy.proposals}: {job.proposal_count}.{" "}
        <a href={reviewHref} className="underline underline-offset-4">{copy.review}</a></p> : null}
      <time dateTime={job.updated_at} className="text-xs text-fg-3">{new Date(job.updated_at).toLocaleString("ru-RU", { timeZone: "UTC" })} UTC</time>
      {canRetry && retryable(job) ? <div><button type="button" className={button} onClick={() => onRetry(job.job_id)}>{copy.retry}</button></div> : null}
    </li>)}
  </ul>;
}

/** Only explicit commands enqueue. Opening, polling and pagination are GETs. */
export function DocumentRecognitionJobs({ access, sourceVersionId, sourceReady }: {
  access: DocumentRecognitionAccess; sourceVersionId: string | null; sourceReady: boolean;
}) {
  const id = useId();
  const ready = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [page, setPage] = useState<RecognitionHistoryPage | null>(null);
  const [readError, setReadError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState<{ retryOf: string | null } | null>(null);
  const [consent, setConsent] = useState(false);
  const [sending, setSending] = useState(false);
  const inFlight = useRef(false);
  const [unresolved, setUnresolved] = useState<DocumentRecognitionRequest | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const canEnqueue = sourceVersionId !== null && access.canEnqueue && sourceReady && access.profileRevision !== null;

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    async function load() {
      try {
        const result = await readRecognitionHistory(access.studentCaseId, sourceVersionId, cursor, controller.signal);
        if (!stopped) { setPage(result); setReadError(false); }
      } catch { if (!stopped) setReadError(true); }
      finally { if (!stopped) timer = setTimeout(load, 8000); }
    }
    void load();
    return () => { stopped = true; controller.abort(); clearTimeout(timer); };
  }, [open, access.studentCaseId, sourceVersionId, cursor, refresh]);

  function choose(retryOf: string | null) {
    if (!canEnqueue || inFlight.current || unresolved) return;
    setSelected({ retryOf }); setConsent(false); setMessage(null);
  }
  async function dispatch(command: DocumentRecognitionRequest) {
    if (inFlight.current) return;
    inFlight.current = true; setSending(true); setMessage(null);
    try {
      await submitRecognitionRequest(access.studentCaseId, command);
      setUnresolved(null); setSelected(null); setConsent(false); setMessage(copy.accepted);
      setCursor(null); setPage(null); setRefresh(value => value + 1);
    } catch (error) {
      const unknown = !(error instanceof DocumentRecognitionClientError) || error.uncertain;
      setUnresolved(unknown ? command : null);
      setMessage(unknown ? copy.uncertain : documentRecognitionError(error.code));
      setRefresh(value => value + 1);
    } finally { inFlight.current = false; setSending(false); }
  }
  function start() {
    if (!canEnqueue || !consent || !selected || unresolved || inFlight.current || access.profileRevision === null || sourceVersionId === null) return;
    const command = { source_version_id: sourceVersionId, expected_profile_revision: access.profileRevision,
      request_id: crypto.randomUUID(), retry_of_job_id: selected.retryOf };
    void dispatch(command);
  }

  return <section className="mt-3 border-t border-border pt-1" data-testid="document-recognition">
    <button type="button" className="min-h-11 w-full text-left text-sm font-medium disabled:cursor-wait"
      disabled={!ready} aria-busy={!ready} aria-expanded={open} aria-controls={id}
      onClick={() => setOpen(value => !value)}>{sourceVersionId === null ? copy.caseTitle : copy.title}{unresolved ? ` · ${copy.uncertain}` : ""}</button>
    <div id={id} hidden={!open} className="space-y-3 pb-2">
      {sourceVersionId === null ? <p className="text-sm text-fg-2">{copy.caseDetail}</p> : null}
      {readError ? <p role="status" className="text-sm text-fg-2">{copy.unavailable}</p> : null}
      {!page && !readError ? <p role="status" className="text-sm text-fg-2">{copy.loading}</p> : null}
      {page?.jobs.length === 0 ? <p className="text-sm text-fg-2">{sourceVersionId === null ? copy.caseEmpty : copy.empty}</p> : null}
      {page ? <DocumentRecognitionJobList jobs={page.jobs} reviewHref={access.reviewHref}
        canRetry={canEnqueue && !sending && !unresolved && !readError} onRetry={jobId => choose(jobId)} /> : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={button} onClick={() => setRefresh(value => value + 1)}>{copy.refresh}</button>
        {cursor !== null ? <button type="button" className={button} onClick={() => { setPage(null); setCursor(null); }}>{copy.latest}</button> : null}
        {page?.next_cursor ? <button type="button" className={button} onClick={() => { setCursor(page.next_cursor); setPage(null); }}>{copy.older}</button> : null}
      </div>
      {canEnqueue ? <button type="button" className={button} disabled={sending || !!unresolved || !page || readError}
        onClick={() => choose(null)}>{copy.extract}</button>
        : sourceVersionId !== null ? <p className="text-sm text-fg-2">{access.profileRevision === null ? copy.profileMissing : copy.readOnly}</p> : null}
      {selected && !unresolved ? <form className="space-y-2" onSubmit={event => { event.preventDefault(); start(); }}>
        {selected.retryOf !== null ? <p className="text-sm text-fg-2">{copy.retryCharge}</p> : null}
        <label className="flex min-h-11 items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={consent}
          disabled={sending} onChange={event => setConsent(event.target.checked)} />{copy.charge}</label>
        <div className="flex flex-wrap gap-2"><button type="submit" className={button} disabled={!consent || !canEnqueue || sending}>
          {sending ? copy.sending : copy.send}</button>
          <button type="button" className={button} disabled={sending} onClick={() => { setSelected(null); setConsent(false); }}>{copy.cancel}</button></div>
      </form> : null}
      {message ? <p role="status" className="text-sm text-fg-2">{message}</p> : null}
      {unresolved ? <div className="space-y-1"><p className="text-sm text-fg-2">{copy.replayDetail}</p>
        <button type="button" className={button} disabled={sending} onClick={() => void dispatch(unresolved)}>{sending ? copy.sending : copy.replay}</button></div> : null}
    </div>
  </section>;
}
