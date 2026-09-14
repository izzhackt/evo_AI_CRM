"use client";

import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { useActionState, useId, useRef, useState } from "react";
import type { UniversityFormAction, UniversityFormActionState } from "@/lib/university-form-ui";
import { universityFormActionMessage, universityFormWorkspace as words } from "@/lib/v3/wording";

const input = "min-h-11 w-full rounded-ctl border border-control-edge bg-surface px-3 py-2 text-base text-fg";
const button = "inline-flex min-h-11 items-center justify-center rounded-ctl px-4 py-2 text-sm font-medium disabled:cursor-wait disabled:opacity-60";

export function UniversityFormCreate({ catalogId, templateId, requestId, action }: {
  catalogId: string; templateId: string; requestId: string; action: UniversityFormAction;
}) {
  const [title, setTitle] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const pendingForm = useRef<FormData | null>(null);
  const id = useId();
  const initial: UniversityFormActionState = { status: "idle", requestId, receipt: null };
  const [state, submit, pending] = useActionState(async (previous: UniversityFormActionState, form: FormData) => {
    // An uncertain retry must carry the exact same intent, not edited contents.
    const exactForm = pendingForm.current ?? form;
    pendingForm.current = exactForm;
    try {
      const result = await action(previous, exactForm);
      const unknown = result.status === "unavailable";
      setUncertain(unknown);
      if (!unknown) pendingForm.current = null;
      return result;
    } catch (error) {
      unstable_rethrow(error);
      setUncertain(true);
      return { status: "unavailable" as const, requestId, receipt: null };
    }
  }, initial);
  const feedback = universityFormActionMessage(state.status);
  const saved = state.status === "saved";
  const blocked = ["forbidden", "stale_revision", "request_conflict", "source_changed", "archived"].includes(state.status);
  const listUrl = `/v3/universities/${catalogId}/forms`;

  return <section aria-labelledby={`${id}-heading`} className="max-w-2xl space-y-5">
    <div className="space-y-2">
      <h2 id={`${id}-heading`} className="text-xl font-bold text-fg">{words.createTitle}</h2>
      <p className="text-sm leading-6 text-fg-2">{words.createExplanation}</p>
    </div>
    <form action={submit} aria-busy={pending} className="space-y-5">
      <input type="hidden" name="operation" value="create" />
      <input type="hidden" name="catalog_id" value={catalogId} />
      <input type="hidden" name="template_id" value={templateId} />
      <input type="hidden" name="expected_revision" value="0" />
      <input type="hidden" name="request_id" value={requestId} />
      <input type="hidden" name="reason" value={words.createReason} />
      <div className="space-y-2">
        <label htmlFor={`${id}-name`} className="block text-sm font-medium text-fg">{words.name}</label>
        <input id={`${id}-name`} name="title" className={input} value={title}
          onChange={event => setTitle(event.target.value)} required maxLength={200}
          readOnly={pending || uncertain || saved || blocked} autoComplete="off"
          aria-describedby={`${id}-hint${feedback ? ` ${id}-feedback` : ""}`} />
        <p id={`${id}-hint`} className="text-sm text-fg-2">{words.nameExample}</p>
      </div>
      {feedback ? <p id={`${id}-feedback`} role="alert" className="text-sm leading-6 text-danger">{feedback}</p> : null}
      {saved ? <p role="status" className="text-sm text-fg">{words.saved}</p> : null}
      <div className="flex flex-wrap items-center gap-3">
        {!saved && !blocked ? <button type="submit" disabled={pending || !title.trim()}
          className={`${button} bg-accent text-on-accent`}>
          {pending ? words.creating : uncertain ? words.retry : words.create}
        </button> : null}
        {saved && state.receipt ? <Link prefetch={false} href={`${listUrl}?template=${state.receipt.template_id}`} className={`${button} bg-accent text-on-accent`}>{words.upload}</Link> : null}
        <Link prefetch={false} href={listUrl} className={`${button} text-fg-2`}>{uncertain || blocked ? words.checkSaved : words.cancel}</Link>
      </div>
    </form>
  </section>;
}
