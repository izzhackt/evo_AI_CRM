"use client";

import { unstable_rethrow } from "next/navigation";
import { useActionState, useId, useRef, useState } from "react";
import type { UniversityFormAction, UniversityFormActionState } from "@/lib/university-form-ui";
import type { UniversityFormMappingMetadata } from "@/lib/university-form-registry";
import { universityFormActionMessage, universityFormManagement as words, universityFormWorkspace as shared } from "@/lib/v3/wording";

type Decision = { operation: "review_mapping" | "publish"; mapping: UniversityFormMappingMetadata }
  | { operation: "archive"; mapping?: never };
const input = "min-h-11 w-full rounded-ctl border border-control-edge bg-surface px-3 py-2 text-base text-fg";

/** One explicit decision. Never chains review, publication and export together. */
export function UniversityFormDecision({ catalogId, templateId, versionId, revision, requestId, decision, action, returnUrl }: {
  catalogId: string; templateId: string; versionId: string | null; revision: number; requestId: string;
  decision: Decision; action: UniversityFormAction; returnUrl?: string;
}) {
  const id = useId();
  const [confirmed, setConfirmed] = useState(false);
  const [reviewDecision, setReviewDecision] = useState("approved");
  const [comment, setComment] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const frozen = useRef<FormData | null>(null);
  const initial: UniversityFormActionState = { status: "idle", requestId, receipt: null };
  const [state, submit, pending] = useActionState(async (previous: UniversityFormActionState, form: FormData) => {
    const exact = frozen.current ?? form; frozen.current = exact;
    try {
      const result = await action(previous, exact);
      setUncertain(result.status === "unavailable");
      if (result.status !== "unavailable") frozen.current = null;
      return result;
    } catch (error) {
      unstable_rethrow(error); setUncertain(true);
      return { status: "unavailable" as const, requestId, receipt: null };
    }
  }, initial);
  const saved = state.status === "saved";
  const blocked = ["forbidden", "stale_revision", "request_conflict", "source_changed", "archived", "not_inspected", "not_ready"].includes(state.status);
  const locked = pending || uncertain || saved || blocked;
  const metadata = decision.operation === "review_mapping"
    ? { title: words.review, explanation: words.reviewExplanation, confirm: words.reviewConfirm, reason: words.reviewReason, saved: words.reviewSaved }
    : decision.operation === "publish"
      ? { title: words.publish, explanation: words.publishExplanation, confirm: words.publishConfirm, reason: words.publishReason, saved: words.publishSaved }
      : { title: words.archive, explanation: words.archiveExplanation, confirm: words.archiveConfirm, reason: words.archiveReason, saved: words.archiveSaved };
  const base = returnUrl ?? `/v3/universities/${catalogId}/forms?template=${templateId}${versionId ? `&version=${versionId}` : ""}`;
  const feedback = universityFormActionMessage(state.status);
  if (decision.operation === "publish" && decision.mapping.review?.decision !== "approved") return null;
  return <section aria-labelledby={`${id}-title`} className="max-w-2xl space-y-4">
    <div className="space-y-2"><h3 id={`${id}-title`} className="text-lg font-bold text-fg">{metadata.title}</h3>
      <p className="text-sm leading-6 text-fg-2">{metadata.explanation}</p></div>
    <form action={submit} aria-busy={pending} className="space-y-4">
      {Object.entries({ operation: decision.operation, template_id: templateId, request_id: requestId,
        expected_revision: String(revision), reason: comment.trim() || metadata.reason,
        ...(decision.operation !== "archive" ? { mapping_id: decision.mapping.id, mapping_sha256: decision.mapping.sha256 } : {}),
        ...(decision.operation === "publish" ? { review_id: decision.mapping.review!.id } : {}),
      }).map(([key, value]) => <input key={key} type="hidden" name={key} value={value} />)}
      {decision.operation === "review_mapping" ? <div className="space-y-2">
        <label htmlFor={`${id}-decision`} className="block text-sm font-medium text-fg">{words.decision}</label>
        <select id={`${id}-decision`} name="decision" value={reviewDecision} onChange={event => setReviewDecision(event.target.value)} disabled={locked} className={input}>
          <option value="approved">{words.approve}</option><option value="rejected">{words.reject}</option>
        </select>
      </div> : null}
      <div className="space-y-2"><label htmlFor={`${id}-comment`} className="block text-sm font-medium text-fg">{words.comment}</label>
        <input id={`${id}-comment`} value={comment} onChange={event => setComment(event.target.value)} readOnly={locked} maxLength={500} className={input} /></div>
      <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm leading-6 text-fg">
        <input type="checkbox" name="confirmed" value="yes" checked={confirmed} disabled={locked}
          onChange={event => setConfirmed(event.target.checked)} className="h-5 w-5 shrink-0 accent-accent" />{metadata.confirm}
      </label>
      {feedback ? <p role="alert" className="text-sm leading-6 text-danger">{feedback}</p> : null}
      {saved ? <p role="status" className="text-sm text-fg">{metadata.saved}</p> : null}
      <div className="flex flex-wrap items-center gap-3">
        {!saved && !blocked ? <button type="submit" disabled={pending || !confirmed}
          className="min-h-11 rounded-ctl bg-accent px-4 py-2 text-sm font-medium text-on-accent disabled:opacity-60">
          {pending ? words.saving : uncertain ? shared.retry : metadata.title}
        </button> : null}
        {saved || uncertain || blocked ? <a href={base} className="inline-flex min-h-11 items-center px-3 text-sm font-medium text-fg-2">{saved ? words.next : shared.reload}</a> : null}
      </div>
    </form>
  </section>;
}
