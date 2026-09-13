"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { UniversityFormVersionMetadata } from "@/lib/university-form-registry";
import type { UniversityTemplateIngressReceipt, UniversityTemplateInspectionMetadata } from "@/lib/university-template-ingress";
import { readUniversityTemplateStatus, reconcileUniversityTemplateUpload, universityTemplateSourceUrl, UniversityTemplateRequestRejectedError } from "@/lib/university-template-upload-client";
import { universityFormWorkspace as words, universityFormActionMessage, universityTemplateUploadFailure, universityTemplateUploadState } from "@/lib/v3/wording";

const button = "inline-flex min-h-11 items-center justify-center rounded-ctl border border-border px-4 py-2 text-sm font-medium text-fg disabled:opacity-60";
const active = (receipt: UniversityTemplateIngressReceipt | null) => receipt !== null && ["prepared", "processing", "sealed"].includes(receipt.state);
type Intent = { request_id: string; expected_revision: number; reason: string };

export function UniversityFormUploadStatus({ catalogId, templateId, version, initialInspection, initialReceipt = null, checkOnMount = false }: {
  catalogId: string; templateId: string; version: Pick<UniversityFormVersionMetadata, "id" | "sha256" | "byte_size" | "mime_type" | "revision">;
  initialInspection: UniversityTemplateInspectionMetadata | null;
  initialReceipt?: UniversityTemplateIngressReceipt | null; checkOnMount?: boolean;
}) {
  const [receipt, setReceipt] = useState(initialReceipt ?? initialInspection?.ingress ?? null);
  const [revision, setRevision] = useState(initialInspection?.template_revision ?? initialReceipt?.revision ?? version.revision);
  const [unavailable, setUnavailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [poll, setPoll] = useState(checkOnMount || active(receipt) ? 1 : 0);
  const intents = useRef<Partial<Record<"cancel" | "reconcile", Intent>>>({});
  const operationController = useRef<AbortController | null>(null);
  const id = useId();
  const sourceMatches = (next: UniversityTemplateIngressReceipt) => next.sha256 === version.sha256 && next.byte_size === version.byte_size;

  useEffect(() => () => operationController.current?.abort(), []);
  useEffect(() => {
    if (!poll) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    async function check() {
      try {
        const result = await readUniversityTemplateStatus(templateId, version.id, AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]));
        if (controller.signal.aborted) return;
        if (result.template_sha256 !== version.sha256 || result.mime_type !== version.mime_type
          || (result.ingress && result.ingress.byte_size !== version.byte_size)) throw new Error("version_changed");
        setReceipt(result.ingress); setRevision(result.template_revision); setUnavailable(false);
        if (active(result.ingress) && ++attempts < 30) timer = setTimeout(check, 2000);
        else { setPoll(0); if (active(result.ingress)) setUnavailable(true); }
      } catch {
        if (!controller.signal.aborted) { setUnavailable(true); setPoll(0); }
      }
    }
    void check();
    return () => { controller.abort(); if (timer) clearTimeout(timer); };
  }, [poll, templateId, version.id, version.sha256, version.byte_size, version.mime_type]);

  async function command(operation: "cancel" | "reconcile") {
    if (busy || blocked || (operation === "cancel" && !confirmed)) return;
    const controller = new AbortController(); operationController.current = controller;
    const intent = intents.current[operation] ?? { request_id: crypto.randomUUID(), expected_revision: revision,
      reason: operation === "cancel" ? words.cancelReason : words.reconcileReason };
    intents.current[operation] = intent;
    setBusy(true); setPoll(0);
    try {
      const result = await reconcileUniversityTemplateUpload(templateId, version.id, operation, intent,
        AbortSignal.any([controller.signal, AbortSignal.timeout(45000)]));
      if (!sourceMatches(result)) throw new Error("version_changed");
      if (controller.signal.aborted) return;
      delete intents.current[operation]; setReceipt(result); setRevision(result.revision); setUnavailable(false);
      setPoll(1);
    } catch (error) {
      if (!controller.signal.aborted) {
        if (error instanceof UniversityTemplateRequestRejectedError) {
          delete intents.current[operation];
          setBlocked(universityFormActionMessage(error.code) ?? universityTemplateUploadFailure(error.code) ?? words.reload);
        }
        setUnavailable(true); setPoll(1);
      }
    }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }

  const verified = receipt?.state === "verified" || initialInspection?.inspection === "verified";
  const error = receipt?.failure_code ? universityTemplateUploadFailure(receipt.failure_code) : null;
  const context = `/v3/universities/${catalogId}/forms?template=${templateId}&version=${version.id}`;
  return <section aria-label={words.version} aria-busy={busy} className="space-y-4">
    <p role="status" className="text-sm font-medium text-fg">{verified ? words.verified : receipt ? universityTemplateUploadState(receipt.state) : words.inspectPending}</p>
    {error ? <p role="alert" className="text-sm leading-6 text-danger">{error}</p> : null}
    {blocked ? <p role="alert" className="text-sm leading-6 text-danger">{blocked}</p> : null}
    {unavailable ? <p role="alert" className="text-sm leading-6 text-fg-2">{words.statusUnavailable}</p>
      : active(receipt) ? <p className="text-sm leading-6 text-fg-2">{words.pendingExplanation}</p>
      : receipt?.state === "unknown" ? <p className="text-sm leading-6 text-fg-2">{words.unknownExplanation}</p> : null}
    <div className="flex flex-wrap gap-3">
      {verified ? <a href={universityTemplateSourceUrl(templateId, version.id)} target="_blank" rel="noopener noreferrer" className={button}>{words.openSource}</a> : null}
      {!verified ? <button type="button" className={button} disabled={busy || !!poll} onClick={() => setPoll(1)}>{poll ? words.checking : words.refreshStatus}</button> : null}
      {receipt?.can_reconcile ? <button type="button" className={button} disabled={busy || !!blocked} onClick={() => void command("reconcile")}>{words.reconcile}</button> : null}
      <a href={context} className={button}>{words.reload}</a>
    </div>
    {receipt?.can_cancel ? <div className="space-y-3 border-t border-border pt-4">
      <label htmlFor={`${id}-cancel`} className="flex min-h-11 items-center gap-3 text-sm text-fg-2">
        <input id={`${id}-cancel`} type="checkbox" checked={confirmed} disabled={busy || !!blocked} onChange={event => setConfirmed(event.target.checked)} className="h-5 w-5" />{words.cancelConfirm}
      </label>
      <button type="button" className={button} disabled={busy || !!blocked || !confirmed} onClick={() => void command("cancel")}>{words.cancelUpload}</button>
    </div> : null}
  </section>;
}
