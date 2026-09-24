"use client";

import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { useActionState, useEffect, useId, useRef, useState } from "react";
import type { UniversityFormAction, UniversityFormActionState } from "@/lib/university-form-ui";
import type { UniversityFormVersionMetadata } from "@/lib/university-form-registry";
import type { UniversityTemplateIngressReceipt } from "@/lib/university-template-ingress";
import { prepareUniversityTemplateFile, uploadUniversityTemplateFile, type UniversityTemplateFile } from "@/lib/university-template-upload-client";
import { universityFormActionMessage, universityFormWorkspace as words } from "@/lib/v3/wording";
import { UniversityFormUploadStatus } from "./UniversityFormUploadStatus";

const input = "min-h-11 w-full rounded-ctl border border-control-edge bg-surface px-3 py-2 text-base text-fg";
type Version = Pick<UniversityFormVersionMetadata, "id" | "sha256" | "byte_size" | "mime_type" | "revision">;
type State = { error: string | null; version: Version | null; receipt: UniversityTemplateIngressReceipt | null; sent: boolean };

export function UniversityFormUpload({ catalogId, templateId, revision, reserveRequestId, uploadRequestId, version = null, action }: {
  catalogId: string; templateId: string; revision: number; reserveRequestId: string; uploadRequestId: string;
  version?: Version | null; action: UniversityFormAction;
}) {
  const id = useId();
  const [reference, setReference] = useState("");
  const [date, setDate] = useState("");
  const [hasFile, setHasFile] = useState(false);
  const [fileName, setFileName] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [phase, setPhase] = useState<"reserving" | "uploading">("reserving");
  const frozen = useRef<{ source: UniversityTemplateFile; form: FormData } | null>(null);
  const selectedFile = useRef<File | null>(null);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; controller.current?.abort(); };
  }, []);
  const [state, submit, pending] = useActionState(async (_previous: State, form: FormData): Promise<State> => {
    let selected = version;
    // Install cancellation before hashing or reserving. A server reservation may
    // finish after navigation, but its source bytes must never be sent afterwards.
    const operation = new AbortController(); controller.current = operation;
    const stopped = () => operation.signal.aborted || !mounted.current;
    const interrupted = (): State => ({ error: null, version: selected, receipt: null, sent: false });
    try {
      if (stopped()) return interrupted();
      if (!frozen.current) {
        const submittedFile = form.get("file");
        const file = submittedFile instanceof File && submittedFile.size ? submittedFile : selectedFile.current;
        if (!(file instanceof File)) return { error: words.fileInvalid, version: null, receipt: null, sent: false };
        let source: UniversityTemplateFile;
        try { source = await prepareUniversityTemplateFile(file); }
        catch { return stopped() ? interrupted() : { error: words.fileInvalid, version: null, receipt: null, sent: false }; }
        if (stopped()) return interrupted();
        if (selected && (selected.sha256 !== source.sha256 || selected.byte_size !== source.byteSize || selected.mime_type !== source.mime))
          return { error: words.fileMismatch, version: null, receipt: null, sent: false };
        const declaration = new FormData();
        for (const [key, value] of Object.entries({ operation: "reserve_version", template_id: templateId,
          expected_revision: String(revision), request_id: reserveRequestId, reason: words.sourceReason,
          sha256: source.sha256, byte_size: String(source.byteSize), mime_type: source.mime,
          source_reference: reference, source_date: date })) declaration.set(key, value);
        frozen.current = { source, form: declaration };
      }
      if (!selected) {
        setPhase("reserving");
        const initial: UniversityFormActionState = { status: "idle", requestId: reserveRequestId, receipt: null };
        const result = await action(initial, frozen.current.form);
        if (stopped()) return interrupted();
        if (result.status !== "saved" || !result.receipt) {
          const unknown = result.status === "unavailable";
          setUncertain(unknown);
          setBlocked(["forbidden", "stale_revision", "request_conflict", "source_changed", "archived"].includes(result.status));
          if (!unknown) frozen.current = null;
          return { error: universityFormActionMessage(result.status), version: null, receipt: null, sent: false };
        }
        selected = { id: result.receipt.target_id, revision: result.receipt.revision,
          sha256: frozen.current.source.sha256, byte_size: frozen.current.source.byteSize, mime_type: frozen.current.source.mime };
      }
      if (stopped()) return interrupted();
      setUncertain(false); setPhase("uploading");
      let receipt: UniversityTemplateIngressReceipt | null = null;
      try {
        receipt = await uploadUniversityTemplateFile(templateId, selected.id, uploadRequestId,
          version ? revision : selected.revision, frozen.current.source, AbortSignal.any([operation.signal, AbortSignal.timeout(120000)]));
      } catch { /* A lost response is reconciled by status; never resend bytes here. */ }
      return { error: null, version: selected, receipt, sent: true };
    } catch (error) {
      unstable_rethrow(error);
      if (stopped()) return interrupted();
      setUncertain(true);
      return { error: universityFormActionMessage("unavailable"), version: selected, receipt: null, sent: false };
    } finally {
      if (controller.current === operation) controller.current = null;
    }
  }, { error: null, version: null, receipt: null, sent: false });

  if (state.sent && state.version) return <UniversityFormUploadStatus catalogId={catalogId} templateId={templateId}
    version={state.version} initialInspection={null} initialReceipt={state.receipt} checkOnMount />;
  return <section aria-labelledby={`${id}-title`} className="max-w-2xl space-y-5">
    <h2 id={`${id}-title`} className="t-section text-fg">{words.upload}</h2>
    <form action={submit} aria-busy={pending} className="space-y-5">
      <div className="space-y-2">
        <label htmlFor={`${id}-file`} className="block text-sm font-medium text-fg">{words.file}</label>
        <input id={`${id}-file`} name="file" type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          required={!hasFile} disabled={pending || uncertain || blocked} className={input} aria-describedby={`${id}-hint`}
          onChange={event => { selectedFile.current = event.target.files?.[0] ?? null; setHasFile(!!selectedFile.current); setFileName(selectedFile.current?.name ?? ""); }} />
        <p id={`${id}-hint`} className="text-sm text-fg-2">{words.fileHint}</p>
        {fileName ? <p className="break-all text-sm text-fg-2">{words.selectedFile} {fileName}</p> : null}
      </div>
      {!version ? <>
        <div className="space-y-2"><label htmlFor={`${id}-source`} className="block text-sm font-medium text-fg">{words.source}</label>
          <input id={`${id}-source`} className={input} value={reference} onChange={event => setReference(event.target.value)} readOnly={pending || uncertain || blocked} required maxLength={500} />
          <p className="text-sm text-fg-2">{words.sourceHint}</p></div>
        <div className="max-w-xs space-y-2"><label htmlFor={`${id}-date`} className="block text-sm font-medium text-fg">{words.sourceDate}</label>
          <input id={`${id}-date`} type="date" className={input} value={date} onChange={event => setDate(event.target.value)} readOnly={pending || uncertain || blocked} required min="1900-01-01" max="2100-12-31" /></div>
      </> : null}
      {state.error ? <p role="alert" className="text-sm leading-6 text-danger">{state.error}</p> : null}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending || blocked || !hasFile || (!version && (!reference.trim() || !date))}
          className="inline-flex min-h-11 items-center justify-center rounded-ctl bg-accent px-4 py-2 text-sm font-medium text-on-accent disabled:opacity-60">
          {pending ? phase === "reserving" ? words.reserving : words.uploading : uncertain ? words.retry : words.upload}
        </button>
        <Link prefetch={false} href={`/v3/universities/${catalogId}/forms?template=${templateId}`} className="inline-flex min-h-11 items-center px-3 text-sm text-fg-2">{uncertain || blocked ? words.checkSaved : words.cancel}</Link>
      </div>
    </form>
  </section>;
}
