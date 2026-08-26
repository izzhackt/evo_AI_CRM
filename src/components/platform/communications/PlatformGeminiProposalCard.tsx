import { randomUUID } from "node:crypto";

import { reviewPlatformGeminiProposalAction } from "@/lib/platform-gemini-proposal-review-actions";
import type { PlatformGeminiProposalReview } from "@/lib/platform-gemini-proposal-reviews";
import type {
  PlatformGeminiFailureCode,
  PlatformGeminiHandoffReason,
  PlatformGeminiProposal,
  PlatformGeminiProposalFactKey,
  PlatformGeminiProposalIntent,
  PlatformGeminiProposalQualificationState,
  PlatformGeminiProposalRisk,
} from "@/lib/platform-gemini-proposals";

export type PlatformGeminiProposalCardLabels = Readonly<{
  title: string;
  hint: string;
  noProposal: string;
  unavailable: string;
  pending: string;
  proposalReady: string;
  humanReview: string;
  reviewRequired: string;
  noAutonomousAuthority: string;
  providerBlocked: string;
  failure: string;
  reply: string;
  intent: string;
  confidence: string;
  risk: string;
  language: string;
  languageRu: string;
  languageEn: string;
  handoff: string;
  handoffYes: string;
  handoffNo: string;
  handoffReasons: string;
  qualification: string;
  completeness: string;
  missingFacts: string;
  noMissingFacts: string;
  notes: string;
  memoryChanges: string;
  noMemoryChanges: string;
  changeSet: string;
  changeClear: string;
  citations: string;
  noCitations: string;
  model: string;
  schemaVersion: string;
  sourceMessage: string;
  requestedAt: string;
  completedAt: string;
  summary: string;
  nextAction: string;
  internalNote: string;
  missingDocument: string;
  noMissingDocument: string;
  deadlineWarning: string;
  noDeadlineWarning: string;
  limitations: string;
  uncertainty: string;
  uncertaintyLabels: Readonly<Record<"low" | "medium" | "high", string>>;
  reviewTitle: string;
  reviewsUnavailable: string;
  reviewAccepted: string;
  reviewEdited: string;
  reviewRejected: string;
  reviewedBy: string;
  reviewReason: string;
  acceptAction: string;
  editAction: string;
  rejectAction: string;
  editHint: string;
  rejectReason: string;
  mutationSaved: string;
  mutationInvalid: string;
  mutationUnavailable: string;
  intentLabels: Readonly<Record<PlatformGeminiProposalIntent, string>>;
  riskLabels: Readonly<Record<PlatformGeminiProposalRisk, string>>;
  handoffReasonLabels: Readonly<Record<PlatformGeminiHandoffReason, string>>;
  failureLabels: Readonly<Record<PlatformGeminiFailureCode, string>>;
  factLabels: Readonly<Record<PlatformGeminiProposalFactKey, string>>;
  qualificationLabels: Readonly<
    Record<PlatformGeminiProposalQualificationState, string>
  >;
}>;

function formatTimestamp(value: string, locale: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  const language =
    locale === "ky" ? "ky-KG" : locale === "en" ? "en-GB" : "ru-RU";
  return new Intl.DateTimeFormat(language, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

function testId(base: string, suffix: string) {
  return `${base}${suffix}`;
}

function outcomeLabel(
  proposal: PlatformGeminiProposal,
  labels: PlatformGeminiProposalCardLabels,
) {
  if (proposal.outcome === "pending") return labels.pending;
  if (proposal.outcome === "human_review") return labels.humanReview;
  return labels.proposalReady;
}

export function PlatformGeminiProposalCard({
  conversationId,
  labels,
  locale,
  proposal,
  reviews,
  reviewsUnavailable,
  reviewMutationOutcome,
  testIdSuffix = "",
  unavailable,
}: {
  conversationId: string;
  labels: PlatformGeminiProposalCardLabels;
  locale: string;
  proposal: PlatformGeminiProposal | null;
  reviews: readonly PlatformGeminiProposalReview[];
  reviewsUnavailable: boolean;
  reviewMutationOutcome: "saved" | "invalid" | "unavailable" | null;
  testIdSuffix?: string;
  unavailable: boolean;
}) {
  const currentReview = proposal
    ? reviews.find((review) => review.proposalRequestId === proposal.requestId) ?? null
    : null;
  const decisionLabel = (review: PlatformGeminiProposalReview) =>
    review.decision === "accepted"
      ? labels.reviewAccepted
      : review.decision === "edited"
        ? labels.reviewEdited
        : labels.reviewRejected;
  const mutationLabel = reviewMutationOutcome === "saved"
    ? labels.mutationSaved
    : reviewMutationOutcome === "invalid"
      ? labels.mutationInvalid
      : reviewMutationOutcome === "unavailable"
        ? labels.mutationUnavailable
        : null;
  return (
    <section
      id="gemini-review"
      className="border-y border-border py-3"
      data-autonomous-authority={String(proposal?.autonomousAuthority ?? false)}
      data-human-review-required={String(proposal?.humanReviewRequired ?? true)}
      data-outcome={unavailable ? "unavailable" : proposal?.outcome ?? "none"}
      data-provider-proof-state={proposal?.providerProofState ?? "blocked"}
      data-testid={testId("platform-gemini-proposal-card", testIdSuffix)}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[11px] font-bold uppercase tracking-[0.05em] text-fg">
            {labels.title}
          </h3>
          <p className="mt-1 text-[10.5px] leading-4 text-fg-3">{labels.hint}</p>
        </div>
        <span
          className="shrink-0 rounded-full border border-warn/25 bg-warn-weak px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.04em] text-warn"
          data-testid={testId("platform-gemini-proposal-status", testIdSuffix)}
        >
          {unavailable
            ? labels.unavailable
            : proposal
              ? outcomeLabel(proposal, labels)
              : labels.noProposal}
        </span>
      </div>

      <div className="mt-3 border-l-2 border-warn/40 pl-2 text-[10.5px] leading-4 text-fg-3">
        <p className="font-semibold text-warn">{labels.reviewRequired}</p>
        <p>{labels.noAutonomousAuthority}</p>
        <p>{labels.providerBlocked}</p>
      </div>

      {unavailable ? (
        <p
          className="mt-3 text-[10.5px] leading-4 text-fg-3"
          data-testid={testId("platform-gemini-proposal-unavailable", testIdSuffix)}
        >
          {labels.unavailable}
        </p>
      ) : !proposal ? (
        <p className="mt-3 text-[10.5px] leading-4 text-fg-3">
          {labels.noProposal}
        </p>
      ) : proposal.outcome === "pending" ? (
        <p className="mt-3 text-[10.5px] leading-4 text-fg-3">
          {labels.pending}
        </p>
      ) : proposal.outcome === "human_review" ? (
        <div
          className="mt-3"
          data-failure-code={proposal.failureCode}
          data-testid={testId("platform-gemini-proposal-failure", testIdSuffix)}
        >
          <p className="text-[10px] font-bold uppercase tracking-[0.04em] text-fg-3">
            {labels.failure}
          </p>
          <p className="mt-1 text-[11px] font-semibold leading-4 text-danger">
            {labels.failureLabels[proposal.failureCode]}
          </p>
        </div>
      ) : (
        <>
          {proposal.schemaVersion === 2 ? (
            <div
              className="mt-3 grid gap-2"
              data-testid={testId("platform-gemini-proposal-guidance", testIdSuffix)}
            >
              {[
                [labels.summary, proposal.summary],
                [labels.nextAction, proposal.nextAction],
                [labels.internalNote, proposal.draftInternalNote],
                [
                  labels.missingDocument,
                  proposal.missingDocumentSuggestion ?? labels.noMissingDocument,
                ],
                [
                  labels.deadlineWarning,
                  proposal.deadlineWarning ?? labels.noDeadlineWarning,
                ],
              ].map(([label, value]) => (
                <div className="border-l border-info/30 pl-2" key={label}>
                  <p className="text-[9.5px] font-bold uppercase tracking-[0.04em] text-fg-3">
                    {label}
                  </p>
                  <p className="mt-0.5 whitespace-pre-wrap break-words text-[10.5px] leading-4 text-fg-2">
                    {value}
                  </p>
                </div>
              ))}
              <div className="border-l border-warn/30 pl-2">
                <p className="text-[9.5px] font-bold uppercase tracking-[0.04em] text-fg-3">
                  {labels.limitations}
                </p>
                <ul className="mt-0.5 space-y-1 text-[10.5px] leading-4 text-fg-2">
                  {proposal.limitations.map((limitation) => (
                    <li key={limitation}>• {limitation}</li>
                  ))}
                </ul>
                <p className="mt-1 text-[10.5px] font-semibold text-warn">
                  {labels.uncertainty}: {proposal.uncertainty
                    ? labels.uncertaintyLabels[proposal.uncertainty]
                    : "—"}
                </p>
              </div>
            </div>
          ) : null}

          <div
            className="mt-3 border-l-2 border-info/40 pl-2"
            data-testid={testId("platform-gemini-proposal-reply", testIdSuffix)}
          >
            <p className="text-[10px] font-bold uppercase tracking-[0.04em] text-fg-3">
              {labels.reply}
            </p>
            <p className="mt-1 whitespace-pre-wrap break-words text-[11px] leading-4 text-fg-2">
              {proposal.replyText}
            </p>
          </div>

          <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2">
            {[
              [labels.intent, labels.intentLabels[proposal.intent]],
              [labels.confidence, `${proposal.confidence}%`],
              [labels.risk, labels.riskLabels[proposal.risk]],
              [
                labels.language,
                proposal.language === "ru" ? labels.languageRu : labels.languageEn,
              ],
              [
                labels.handoff,
                proposal.handoffRequired ? labels.handoffYes : labels.handoffNo,
              ],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-[9.5px] font-bold uppercase tracking-[0.04em] text-fg-3">
                  {label}
                </dt>
                <dd className="mt-0.5 break-words text-[10.5px] font-semibold text-fg-2">
                  {value}
                </dd>
              </div>
            ))}
          </dl>

          {proposal.handoffReasons.length ? (
            <div className="mt-3">
              <p className="text-[10px] font-bold uppercase tracking-[0.04em] text-fg-3">
                {labels.handoffReasons}
              </p>
              <ul className="mt-1 space-y-1">
                {proposal.handoffReasons.map((reason) => (
                  <li className="text-[10.5px] leading-4 text-fg-2" key={reason}>
                    {labels.handoffReasonLabels[reason]}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div
            className="mt-3"
            data-testid={testId("platform-gemini-proposal-qualification", testIdSuffix)}
          >
            <p className="text-[10px] font-bold uppercase tracking-[0.04em] text-fg-3">
              {labels.qualification}
            </p>
            <p className="mt-1 text-[10.5px] font-semibold text-fg-2">
              {labels.qualificationLabels[proposal.qualification.status]} · {labels.completeness}{" "}
              {proposal.qualification.completeness}%
            </p>
            <p className="mt-1 text-[10.5px] leading-4 text-fg-3">
              {labels.missingFacts}: {proposal.qualification.missingFactKeys.length
                ? proposal.qualification.missingFactKeys
                    .map((key) => labels.factLabels[key])
                    .join(" · ")
                : labels.noMissingFacts}
            </p>
            {proposal.qualification.notes ? (
              <p className="mt-1 text-[10.5px] leading-4 text-fg-3">
                {labels.notes}: {proposal.qualification.notes}
              </p>
            ) : null}
          </div>

          <div
            className="mt-3"
            data-testid={testId("platform-gemini-proposal-memory-changes", testIdSuffix)}
          >
            <p className="text-[10px] font-bold uppercase tracking-[0.04em] text-fg-3">
              {labels.memoryChanges}
            </p>
            {proposal.memoryChanges.length ? (
              <ul className="mt-1 space-y-1.5">
                {proposal.memoryChanges.map((change) => (
                  <li
                    className="border-l border-info/30 pl-2 text-[10.5px] leading-4 text-fg-2"
                    key={change.factKey}
                  >
                    <span className="font-semibold">{labels.factLabels[change.factKey]}</span>
                    {" · "}
                    {change.action === "set" ? labels.changeSet : labels.changeClear}
                    {change.value ? ` · ${change.value}` : ""}
                    {` · ${change.confidence}%`}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-[10.5px] text-fg-3">{labels.noMemoryChanges}</p>
            )}
          </div>

          <div
            className="mt-3"
            data-testid={testId("platform-gemini-proposal-citations", testIdSuffix)}
          >
            <p className="text-[10px] font-bold uppercase tracking-[0.04em] text-fg-3">
              {labels.citations}
            </p>
            {proposal.citations.length ? (
              <ol className="mt-1 space-y-1.5">
                {proposal.citations.map((citation) => (
                  <li
                    className="border-l border-info/30 pl-2 text-[10.5px] leading-4 text-fg-2"
                    key={`${citation.knowledgeKey}:${citation.knowledgeVersion}:${citation.evidenceOrdinal}`}
                  >
                    {citation.knowledgeKey} · v{citation.knowledgeVersion} · #{citation.evidenceOrdinal}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-1 text-[10.5px] text-fg-3">{labels.noCitations}</p>
            )}
          </div>
        </>
      )}

      {proposal ? (
        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-border pt-3">
          {[
            [labels.model, proposal.modelRef],
            [labels.schemaVersion, `v${proposal.schemaVersion}`],
            [labels.sourceMessage, proposal.sourceMessageId],
            [labels.requestedAt, formatTimestamp(proposal.requestedAt, locale)],
            [
              labels.completedAt,
              proposal.completedAt
                ? formatTimestamp(proposal.completedAt, locale)
                : labels.pending,
            ],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-[9.5px] font-bold uppercase tracking-[0.04em] text-fg-3">
                {label}
              </dt>
              <dd className="mt-0.5 break-words text-[10px] font-semibold text-fg-2">
                {value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      {proposal?.outcome === "proposal_ready" && proposal.schemaVersion === 2 ? (
        <div
          className="mt-3 border-t border-border pt-3"
          data-testid={testId("platform-gemini-proposal-review", testIdSuffix)}
        >
          <p className="text-[10px] font-bold uppercase tracking-[0.04em] text-fg-3">
            {labels.reviewTitle}
          </p>
          {mutationLabel ? (
            <p
              className="mt-2 rounded-md border border-border bg-surface-2 px-2 py-1.5 text-[10.5px] font-semibold text-fg-2"
              data-review-mutation-outcome={reviewMutationOutcome ?? undefined}
            >
              {mutationLabel}
            </p>
          ) : null}
          {reviewsUnavailable ? (
            <p className="mt-2 text-[10.5px] font-semibold text-danger">
              {labels.reviewsUnavailable}
            </p>
          ) : currentReview ? (
            <div
              className="mt-2 border-l-2 border-ok/40 pl-2 text-[10.5px] leading-4 text-fg-2"
              data-review-decision={currentReview.decision}
            >
              <p className="font-bold">{decisionLabel(currentReview)}</p>
              <p>
                {labels.reviewedBy}: {currentReview.reviewedByName} ·{" "}
                {formatTimestamp(currentReview.reviewedAt, locale)}
              </p>
              {currentReview.reason ? (
                <p>{labels.reviewReason}: {currentReview.reason}</p>
              ) : null}
            </div>
          ) : (
            <div className="mt-2 space-y-3">
              <form action={reviewPlatformGeminiProposalAction}>
                <input type="hidden" name="conversation_id" value={conversationId} />
                <input type="hidden" name="proposal_request_id" value={proposal.requestId} />
                <input type="hidden" name="review_request_id" value={randomUUID()} />
                <input type="hidden" name="decision" value="accepted" />
                <input type="hidden" name="reason" value="" />
                <button
                  className="rounded-md bg-ok px-3 py-1.5 text-[10.5px] font-bold text-white"
                  type="submit"
                >
                  {labels.acceptAction}
                </button>
              </form>

              <details className="rounded-md border border-border p-2">
                <summary className="cursor-pointer text-[10.5px] font-bold text-fg-2">
                  {labels.editAction}
                </summary>
                <p className="mt-1 text-[10px] leading-4 text-fg-3">{labels.editHint}</p>
                <form action={reviewPlatformGeminiProposalAction} className="mt-2 space-y-2">
                  <input type="hidden" name="conversation_id" value={conversationId} />
                  <input type="hidden" name="proposal_request_id" value={proposal.requestId} />
                  <input type="hidden" name="review_request_id" value={randomUUID()} />
                  <input type="hidden" name="decision" value="edited" />
                  <label className="block text-[10px] font-semibold text-fg-3">
                    {labels.summary}
                    <textarea className="mt-1 w-full rounded-md border border-border bg-surface p-2 text-[11px] text-fg" defaultValue={proposal.summary ?? ""} maxLength={2000} name="summary" required rows={2} />
                  </label>
                  <label className="block text-[10px] font-semibold text-fg-3">
                    {labels.nextAction}
                    <textarea className="mt-1 w-full rounded-md border border-border bg-surface p-2 text-[11px] text-fg" defaultValue={proposal.nextAction ?? ""} maxLength={1000} name="next_action" required rows={2} />
                  </label>
                  <label className="block text-[10px] font-semibold text-fg-3">
                    {labels.reply}
                    <textarea className="mt-1 w-full rounded-md border border-border bg-surface p-2 text-[11px] text-fg" defaultValue={proposal.replyText} maxLength={2000} name="reply_text" required rows={4} />
                  </label>
                  <label className="block text-[10px] font-semibold text-fg-3">
                    {labels.internalNote}
                    <textarea className="mt-1 w-full rounded-md border border-border bg-surface p-2 text-[11px] text-fg" defaultValue={proposal.draftInternalNote ?? ""} maxLength={4000} name="draft_internal_note" required rows={3} />
                  </label>
                  <label className="block text-[10px] font-semibold text-fg-3">
                    {labels.missingDocument}
                    <textarea className="mt-1 w-full rounded-md border border-border bg-surface p-2 text-[11px] text-fg" defaultValue={proposal.missingDocumentSuggestion ?? ""} maxLength={1000} name="missing_document_suggestion" rows={2} />
                  </label>
                  <label className="block text-[10px] font-semibold text-fg-3">
                    {labels.deadlineWarning}
                    <textarea className="mt-1 w-full rounded-md border border-border bg-surface p-2 text-[11px] text-fg" defaultValue={proposal.deadlineWarning ?? ""} maxLength={1000} name="deadline_warning" rows={2} />
                  </label>
                  <label className="block text-[10px] font-semibold text-fg-3">
                    {labels.limitations}
                    <textarea className="mt-1 w-full rounded-md border border-border bg-surface p-2 text-[11px] text-fg" defaultValue={proposal.limitations.join("\n")} maxLength={4007} name="limitations" required rows={3} />
                  </label>
                  <label className="block text-[10px] font-semibold text-fg-3">
                    {labels.uncertainty}
                    <select className="mt-1 w-full rounded-md border border-border bg-surface p-2 text-[11px] text-fg" defaultValue={proposal.uncertainty ?? "medium"} name="uncertainty">
                      {(["low", "medium", "high"] as const).map((level) => (
                        <option key={level} value={level}>{labels.uncertaintyLabels[level]}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-[10px] font-semibold text-fg-3">
                    {labels.reviewReason}
                    <input className="mt-1 w-full rounded-md border border-border bg-surface p-2 text-[11px] text-fg" maxLength={1000} name="reason" />
                  </label>
                  <button className="rounded-md bg-info px-3 py-1.5 text-[10.5px] font-bold text-white" type="submit">
                    {labels.editAction}
                  </button>
                </form>
              </details>

              <form action={reviewPlatformGeminiProposalAction} className="rounded-md border border-danger/20 p-2">
                <input type="hidden" name="conversation_id" value={conversationId} />
                <input type="hidden" name="proposal_request_id" value={proposal.requestId} />
                <input type="hidden" name="review_request_id" value={randomUUID()} />
                <input type="hidden" name="decision" value="rejected" />
                <label className="block text-[10px] font-semibold text-fg-3">
                  {labels.rejectReason}
                  <input className="mt-1 w-full rounded-md border border-border bg-surface p-2 text-[11px] text-fg" maxLength={1000} minLength={1} name="reason" required />
                </label>
                <button className="mt-2 rounded-md border border-danger/30 px-3 py-1.5 text-[10.5px] font-bold text-danger" type="submit">
                  {labels.rejectAction}
                </button>
              </form>
            </div>
          )}

          {reviews.length ? (
            <ol className="mt-3 space-y-1" data-testid={testId("platform-gemini-review-history", testIdSuffix)}>
              {reviews.map((review) => (
                <li className="text-[10px] leading-4 text-fg-3" key={review.reviewId}>
                  {decisionLabel(review)} · {review.reviewedByName} ·{" "}
                  {formatTimestamp(review.reviewedAt, locale)}
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
