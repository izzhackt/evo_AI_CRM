import { Icon } from "@/components/icons";
import {
  btnDangerGhostCls,
  btnGhostCls,
  cn,
} from "@/components/ui";
import { reviewDocumentAction } from "@/app/(staff)/documents/actions";
import type { DocumentStatus } from "@/lib/domain";
import type { DocumentExperienceCopy } from "./document-copy";
import { DocumentSubmitButton } from "./DocumentSubmitButton";

const decisionTextareaCls =
  "min-h-28 w-full resize-y rounded-ctl border border-border-strong bg-surface px-3 py-2.5 text-[13.5px] leading-5 text-fg placeholder:text-fg-3 transition-[border-color,box-shadow,background-color] hover:bg-surface-2 focus-visible:border-accent";

const approveButtonCls =
  "inline-flex h-11 min-w-11 items-center justify-center gap-2 rounded-ctl border border-ok bg-ok px-4 text-[13.5px] font-semibold text-white transition-[filter,transform] hover:brightness-95 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none motion-reduce:active:scale-100";

function HiddenDocumentFields({ id, status }: { id: number; status: DocumentStatus }) {
  return (
    <>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
    </>
  );
}

export function DocumentDecisionPanel({
  id,
  status,
  copy,
}: {
  id: number;
  status: DocumentStatus;
  copy: DocumentExperienceCopy;
}) {
  return (
    <section aria-labelledby="document-decision-title" className="rounded-card border border-border bg-surface shadow-evo">
      <header className="border-b border-border px-4 py-4 sm:px-5">
        <h2 id="document-decision-title" className="text-[14.5px] font-semibold text-fg">
          {copy.decisionWorkspace}
        </h2>
        <p className="mt-1 text-[12.5px] leading-5 text-fg-3">{copy.decisionDescription}</p>
      </header>

      <div className="space-y-4 p-4 sm:p-5">
        {status === "review" && (
          <>
            <form action={reviewDocumentAction} className="rounded-nav border border-ok/25 bg-ok-weak p-3.5">
              <HiddenDocumentFields id={id} status="approved" />
              <p className="text-[12px] leading-5 text-ok">{copy.approveHint}</p>
              <DocumentSubmitButton type="submit" pendingLabel={copy.saving} className={cn(approveButtonCls, "mt-3 w-full sm:w-auto")}>
                <Icon name="file-check" size={16} />
                {copy.approve}
              </DocumentSubmitButton>
            </form>

            <form action={reviewDocumentAction} className="space-y-3 rounded-nav border border-border bg-surface-2 p-3.5">
              <input type="hidden" name="id" value={id} />
              <div>
                <label htmlFor="document-decision-comment" className="mb-1.5 block text-[12px] font-semibold text-fg-2">
                  {copy.decisionReason}
                </label>
                <textarea
                  id="document-decision-comment"
                  name="comment"
                  required
                  maxLength={1000}
                  aria-describedby="document-decision-help"
                  placeholder={copy.decisionReasonPlaceholder}
                  className={decisionTextareaCls}
                />
                <p id="document-decision-help" className="mt-1.5 text-[11.5px] leading-4 text-fg-3">
                  {copy.decisionReasonHelp}
                </p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <DocumentSubmitButton
                  type="submit"
                  name="status"
                  value="required"
                  pendingLabel={copy.saving}
                  className={cn(btnGhostCls, "border-warn/40 text-warn hover:bg-warn-weak hover:text-warn")}
                >
                  {copy.correction}
                </DocumentSubmitButton>
                <DocumentSubmitButton
                  type="submit"
                  name="status"
                  value="rejected"
                  pendingLabel={copy.saving}
                  className={btnDangerGhostCls}
                >
                  {copy.reject}
                </DocumentSubmitButton>
              </div>
            </form>
          </>
        )}

        {status === "uploaded" && (
          <form action={reviewDocumentAction} className="rounded-nav border border-info/25 bg-info-weak p-3.5">
            <HiddenDocumentFields id={id} status="review" />
            <p className="text-[12.5px] leading-5 text-info">{copy.sendToReviewHint}</p>
            <DocumentSubmitButton
              type="submit"
              pendingLabel={copy.saving}
              className={cn(btnGhostCls, "mt-3 w-full border-info/40 text-info hover:bg-surface/70 hover:text-info sm:w-auto")}
            >
              {copy.sendToReview}
            </DocumentSubmitButton>
          </form>
        )}

        {status === "approved" && (
          <form action={reviewDocumentAction} className="space-y-3 rounded-nav border border-border bg-surface-2 p-3.5">
            <HiddenDocumentFields id={id} status="review" />
            <p className="text-[12.5px] leading-5 text-fg-2">{copy.reopenHint}</p>
            <div>
              <label htmlFor="document-reopen-comment" className="sr-only">
                {copy.reopenReasonPlaceholder}
              </label>
              <textarea
                id="document-reopen-comment"
                name="comment"
                required
                maxLength={1000}
                placeholder={copy.reopenReasonPlaceholder}
                className={decisionTextareaCls}
              />
            </div>
            <DocumentSubmitButton type="submit" pendingLabel={copy.saving} className={btnGhostCls}>
              {copy.reopenReview}
            </DocumentSubmitButton>
          </form>
        )}

        {(status === "required" || status === "rejected") && (
          <div className="flex items-start gap-3 rounded-nav border border-warn/30 bg-warn-weak p-3.5 text-warn">
            <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-nav bg-surface/70">
              <Icon name="alert" size={16} />
            </span>
            <div>
              <h3 className="text-[13px] font-bold">{copy.noDecisionTitle}</h3>
              <p className="mt-1 text-[12.5px] leading-5 opacity-85">{copy.noDecisionDescription}</p>
            </div>
          </div>
        )}

        <p className="flex items-start gap-2 border-t border-border pt-3 text-[11.5px] leading-4 text-fg-3">
          <Icon name="alert" size={14} className="mt-0.5 shrink-0" />
          {copy.mutationBoundary}
        </p>
      </div>
    </section>
  );
}
