"use client";

import { useActionState, useEffect, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";

import { btnCls, btnGhostCls, cn } from "@/components/ui";
import type { FixedRole } from "@/lib/fixed-role-policy";
import type { Locale } from "@/lib/i18n";
import {
  requestCanonicalGeminiProposalAction,
  reviewCanonicalGeminiProposalAction,
  type CanonicalGeminiProposalActionState,
  type CanonicalGeminiProposalReviewActionState,
} from "@/lib/server/canonical-gemini-proposal-actions";
import type { CanonicalGeminiProposalAvailability } from "@/lib/server/canonical-gemini-proposal-config";

const COPY = {
  ru: {
    title: "Черновик Gemini · решение принимает сотрудник",
    description:
      "Gemini может подготовить ответ по этой канонической переписке. EVO сохраняет черновик, но не отправляет его в WhatsApp.",
    request: "Проверить и запросить черновик",
    pending: "Проверяем доступ…",
    latest: "Исходный черновик",
    noDraft: "Сохранённого черновика пока нет.",
    created: "Черновик сохранён в EVO и ожидает решения сотрудника.",
    blocked: "Вызов Gemini заблокирован настройками этого контура.",
    error: "Черновик не создан. EVO ничего не сохранил.",
    feature_disabled: "Функция Gemini выключена.",
    provider_not_authorized: "Отдельное разрешение на реальный вызов Gemini не выдано.",
    configuration_missing: "Не хватает server-only ключа или явно заданной модели.",
    configuration_invalid: "Настройки Gemini некорректны.",
    reviewTitle: "Проверка человеком",
    reviewDescription:
      "Выберите одно окончательное решение. Оно сохранится в EVO, но не отправит сообщение и не изменит CRM-этап.",
    accept: "Принять без изменений",
    editLabel: "Финальный текст после правки",
    saveEdit: "Сохранить правку",
    rejectLabel: "Причина отклонения",
    rejectPlaceholder: "Почему этот черновик нельзя использовать",
    reject: "Отклонить",
    saving: "Сохраняем решение…",
    reviewed: "Решение сохранено в EVO. WhatsApp не отправлялся.",
    invalid: "Проверьте обязательные поля и повторите.",
    forbidden: "Эта роль больше не отвечает за диалог.",
    not_available: "Черновик больше недоступен для этой роли.",
    already_reviewed: "По этому черновику уже принято окончательное решение.",
    request_conflict: "Запрос конфликтует с уже сохранённым решением.",
    reviewError: "Решение не сохранено. Обновите состояние и повторите.",
    finalTitle: "Окончательное решение",
    accepted: "Принят",
    edited: "Принят после правки",
    rejected: "Отклонён",
    finalText: "Проверенный финальный текст",
    reason: "Причина",
    by: "Роль",
    at: "Время",
  },
  ky: {
    title: "Gemini долбоору · чечимди кызматкер кабыл алат",
    description:
      "Gemini каноникалык кат алышуудан жооп долбоорун даярдай алат. EVO аны сактайт, бирок WhatsApp'ка жөнөтпөйт.",
    request: "Текшерип, долбоор сураңыз",
    pending: "Жеткиликтүүлүк текшерилүүдө…",
    latest: "Баштапкы долбоор",
    noDraft: "Сакталган долбоор азырынча жок.",
    created: "Долбоор EVO'до сакталды жана кызматкердин чечимин күтөт.",
    blocked: "Gemini чакыруусу бул контурдун жөндөөлөрү менен бөгөттөлгөн.",
    error: "Долбоор түзүлгөн жок. EVO эч нерсе сактаган жок.",
    feature_disabled: "Gemini функциясы өчүрүлгөн.",
    provider_not_authorized: "Gemini'ни чыныгы чакырууга өзүнчө уруксат берилген жок.",
    configuration_missing: "Server-only ачкыч же так көрсөтүлгөн модель жетишпейт.",
    configuration_invalid: "Gemini жөндөөлөрү туура эмес.",
    reviewTitle: "Адамдын текшерүүсү",
    reviewDescription:
      "Бир акыркы чечим тандаңыз. Ал EVO'до сакталат, бирок билдирүү жөнөтпөйт жана CRM этабын өзгөртпөйт.",
    accept: "Өзгөртүүсүз кабыл алуу",
    editLabel: "Текшерилген акыркы текст",
    saveEdit: "Түзөтүүнү сактоо",
    rejectLabel: "Четке кагуунун себеби",
    rejectPlaceholder: "Бул долбоор эмне үчүн колдонулбайт",
    reject: "Четке кагуу",
    saving: "Чечим сакталууда…",
    reviewed: "Чечим EVO'до сакталды. WhatsApp жөнөтүлгөн жок.",
    invalid: "Милдеттүү талааларды текшериңиз.",
    forbidden: "Бул роль эми диалог үчүн жооптуу эмес.",
    not_available: "Долбоор бул роль үчүн жеткиликсиз.",
    already_reviewed: "Бул долбоор боюнча акыркы чечим мурда кабыл алынган.",
    request_conflict: "Суроо сакталган чечимге каршы келет.",
    reviewError: "Чечим сакталган жок. Абалды жаңылап кайталаңыз.",
    finalTitle: "Акыркы чечим",
    accepted: "Кабыл алынды",
    edited: "Түзөтүлүп кабыл алынды",
    rejected: "Четке кагылды",
    finalText: "Текшерилген акыркы текст",
    reason: "Себеп",
    by: "Роль",
    at: "Убакыт",
  },
  en: {
    title: "Gemini draft · staff decides",
    description:
      "Gemini can prepare a reply from this canonical transcript. EVO stores the draft but does not send it to WhatsApp.",
    request: "Check and request draft",
    pending: "Checking access…",
    latest: "Original draft",
    noDraft: "There is no persisted draft yet.",
    created: "The draft is stored in EVO and awaits a staff decision.",
    blocked: "The Gemini call is blocked by this environment's settings.",
    error: "No draft was created. EVO stored nothing.",
    feature_disabled: "The Gemini feature is disabled.",
    provider_not_authorized: "A separate authorization for a real Gemini call was not granted.",
    configuration_missing: "The server-only key or explicitly configured model is missing.",
    configuration_invalid: "The Gemini configuration is invalid.",
    reviewTitle: "Human review",
    reviewDescription:
      "Choose one final decision. EVO records it without sending a message or changing a consequential CRM state.",
    accept: "Accept unchanged",
    editLabel: "Final reviewed text",
    saveEdit: "Save edit",
    rejectLabel: "Rejection reason",
    rejectPlaceholder: "Why this draft cannot be used",
    reject: "Reject",
    saving: "Saving decision…",
    reviewed: "The decision is stored in EVO. No WhatsApp message was sent.",
    invalid: "Check the required fields and try again.",
    forbidden: "This role no longer owns the conversation.",
    not_available: "The proposal is no longer available to this role.",
    already_reviewed: "A final decision already exists for this proposal.",
    request_conflict: "This request conflicts with the stored decision.",
    reviewError: "The decision was not stored. Refresh the state and retry.",
    finalTitle: "Final decision",
    accepted: "Accepted",
    edited: "Accepted after edit",
    rejected: "Rejected",
    finalText: "Reviewed final text",
    reason: "Reason",
    by: "Role",
    at: "Time",
  },
} as const;

type Proposal = Readonly<{
  proposalId: string;
  model: string;
  proposalText: string;
  sourceMessageId: string;
  reviewDecision: "pending" | "accepted" | "edited" | "rejected";
  reviewedText: string | null;
  reviewedByRole: FixedRole | null;
  reviewedAt: string | null;
  reviewReason: string | null;
}>;

const INITIAL_REQUEST_STATE: CanonicalGeminiProposalActionState = Object.freeze({
  status: "idle",
  reason: null,
  proposalId: null,
});
const INITIAL_REVIEW_STATE: CanonicalGeminiProposalReviewActionState =
  Object.freeze({ status: "idle", decision: null, proposalId: null });

const subscribeToHydration = () => () => undefined;
const clientHydrationSnapshot = () => true;
const serverHydrationSnapshot = () => false;

function reasonText(locale: Locale, reason: string | null): string {
  const copy = COPY[locale];
  if (
    reason === "feature_disabled" ||
    reason === "provider_not_authorized" ||
    reason === "configuration_missing" ||
    reason === "configuration_invalid"
  ) {
    return copy[reason];
  }
  return copy.error;
}

function reviewStateText(
  locale: Locale,
  status: CanonicalGeminiProposalReviewActionState["status"],
): string {
  const copy = COPY[locale];
  if (status === "reviewed") return copy.reviewed;
  if (
    status === "invalid" ||
    status === "forbidden" ||
    status === "not_available" ||
    status === "already_reviewed" ||
    status === "request_conflict"
  ) {
    return copy[status];
  }
  return copy.reviewError;
}

function roleLabel(role: FixedRole | null): string {
  if (role === "admin") return "Admin";
  if (role === "sales") return "Sales";
  if (role === "admissions") return "Admissions";
  return "—";
}

function reviewedAtLabel(value: string | null, locale: Locale): string {
  if (value === null) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return "—";
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

function ReviewHiddenFields({
  conversationId,
  proposalId,
  decision,
  requestId,
}: Readonly<{
  conversationId: string;
  proposalId: string;
  decision: "accepted" | "edited" | "rejected";
  requestId: string;
}>) {
  return (
    <>
      <input type="hidden" name="conversation_id" value={conversationId} />
      <input type="hidden" name="proposal_id" value={proposalId} />
      <input type="hidden" name="decision" value={decision} />
      <input type="hidden" name="review_request_id" value={requestId} />
    </>
  );
}

export function CanonicalGeminiProposalPanel({
  locale,
  conversationId,
  availability,
  proposal,
  reviewRequestId,
}: Readonly<{
  locale: Locale;
  conversationId: string;
  availability: CanonicalGeminiProposalAvailability;
  proposal: Proposal | null;
  reviewRequestId: string | null;
}>) {
  const copy = COPY[locale];
  const router = useRouter();
  const [requestState, requestAction, requesting] = useActionState(
    requestCanonicalGeminiProposalAction,
    INITIAL_REQUEST_STATE,
  );
  const [reviewState, reviewAction, reviewing] = useActionState(
    reviewCanonicalGeminiProposalAction,
    INITIAL_REVIEW_STATE,
  );
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    clientHydrationSnapshot,
    serverHydrationSnapshot,
  );

  useEffect(() => {
    if (requestState.status === "created" || reviewState.status === "reviewed") {
      router.refresh();
    }
  }, [requestState.status, reviewState.status, router]);

  return (
    <section
      className="space-y-4 rounded-card border border-border bg-surface-2 p-4"
      data-testid="canonical-gemini-proposal-panel"
      data-hydrated={hydrated ? "true" : "false"}
    >
      <div>
        <h3 className="text-md font-semibold text-fg">{copy.title}</h3>
        <p className="mt-1 text-sm leading-6 text-fg-3">{copy.description}</p>
      </div>

      <div
        className={cn(
          "rounded-ctl border px-3 py-2 text-sm",
          availability.status === "ready"
            ? "border-ok/30 bg-ok-weak text-ok"
            : "border-info/30 bg-info-weak text-info",
        )}
        data-testid="canonical-gemini-proposal-availability"
        data-status={availability.status}
        data-reason={availability.status === "blocked" ? availability.reason : undefined}
      >
        {availability.status === "ready"
          ? `${availability.model} · server-only`
          : reasonText(locale, availability.reason)}
      </div>

      <form action={requestAction}>
        <input type="hidden" name="conversation_id" value={conversationId} />
        <button
          type="submit"
          className={btnCls}
          disabled={!hydrated || requesting}
          data-testid="canonical-gemini-proposal-request"
        >
          {requesting ? copy.pending : copy.request}
        </button>
      </form>

      {requestState.status !== "idle" ? (
        <p
          className="text-sm leading-6 text-fg-2"
          data-testid="canonical-gemini-proposal-action-state"
          data-status={requestState.status}
          data-reason={requestState.reason ?? undefined}
        >
          {requestState.status === "created"
            ? copy.created
            : requestState.status === "blocked"
              ? `${copy.blocked} ${reasonText(locale, requestState.reason)}`
              : copy.error}
        </p>
      ) : null}

      <div>
        <h4 className="text-sm font-semibold text-fg">{copy.latest}</h4>
        {proposal ? (
          <blockquote
            className="mt-2 whitespace-pre-wrap rounded-ctl border border-border bg-surface px-3 py-3 text-base leading-6 text-fg"
            data-testid="canonical-gemini-proposal-latest"
            data-proposal-id={proposal.proposalId}
            data-source-message-id={proposal.sourceMessageId}
            data-review-decision={proposal.reviewDecision}
          >
            {proposal.proposalText}
          </blockquote>
        ) : (
          <p className="mt-2 text-sm text-fg-3">{copy.noDraft}</p>
        )}
      </div>

      {proposal?.reviewDecision === "pending" && reviewRequestId ? (
        <div
          className="space-y-4 border-t border-border pt-4"
          data-testid="canonical-gemini-review-controls"
        >
          <div>
            <h4 className="text-base font-semibold text-fg">{copy.reviewTitle}</h4>
            <p className="mt-1 text-sm leading-5 text-fg-3">
              {copy.reviewDescription}
            </p>
          </div>

          <form action={reviewAction} data-testid="canonical-gemini-review-accept-form">
            <ReviewHiddenFields
              conversationId={conversationId}
              proposalId={proposal.proposalId}
              decision="accepted"
              requestId={reviewRequestId}
            />
            <input type="hidden" name="reviewed_text" value="" />
            <input type="hidden" name="review_reason" value="" />
            <button
              type="submit"
              className={btnCls}
              disabled={!hydrated || reviewing}
              data-testid="canonical-gemini-review-accept"
            >
              {reviewing ? copy.saving : copy.accept}
            </button>
          </form>

          <form
            action={reviewAction}
            className="space-y-2"
            data-testid="canonical-gemini-review-edit-form"
          >
            <ReviewHiddenFields
              conversationId={conversationId}
              proposalId={proposal.proposalId}
              decision="edited"
              requestId={reviewRequestId}
            />
            <input type="hidden" name="review_reason" value="" />
            <label
              htmlFor={`canonical-gemini-review-edit-${proposal.proposalId}`}
              className="block text-xs font-semibold text-fg-2"
            >
              {copy.editLabel}
            </label>
            <textarea
              id={`canonical-gemini-review-edit-${proposal.proposalId}`}
              name="reviewed_text"
              defaultValue={proposal.proposalText}
              disabled={!hydrated || reviewing}
              required
              maxLength={3000}
              rows={5}
              className="w-full rounded-ctl border border-border bg-surface px-3 py-2 text-base leading-6 text-fg"
              data-testid="canonical-gemini-review-edited-text"
            />
            <button
              type="submit"
              className={btnGhostCls}
              disabled={!hydrated || reviewing}
              data-testid="canonical-gemini-review-edit"
            >
              {reviewing ? copy.saving : copy.saveEdit}
            </button>
          </form>

          <form
            action={reviewAction}
            className="space-y-2"
            data-testid="canonical-gemini-review-reject-form"
          >
            <ReviewHiddenFields
              conversationId={conversationId}
              proposalId={proposal.proposalId}
              decision="rejected"
              requestId={reviewRequestId}
            />
            <input type="hidden" name="reviewed_text" value="" />
            <label
              htmlFor={`canonical-gemini-review-reason-${proposal.proposalId}`}
              className="block text-xs font-semibold text-fg-2"
            >
              {copy.rejectLabel}
            </label>
            <textarea
              id={`canonical-gemini-review-reason-${proposal.proposalId}`}
              name="review_reason"
              disabled={!hydrated || reviewing}
              required
              maxLength={2000}
              rows={3}
              placeholder={copy.rejectPlaceholder}
              className="w-full rounded-ctl border border-border bg-surface px-3 py-2 text-base leading-6 text-fg"
              data-testid="canonical-gemini-review-reason"
            />
            <button
              type="submit"
              className={btnGhostCls}
              disabled={!hydrated || reviewing}
              data-testid="canonical-gemini-review-reject"
            >
              {reviewing ? copy.saving : copy.reject}
            </button>
          </form>
        </div>
      ) : null}

      {reviewState.status !== "idle" ? (
        <p
          role="status"
          className={cn(
            "text-sm leading-6",
            reviewState.status === "reviewed" ? "text-ok" : "text-danger",
          )}
          data-testid="canonical-gemini-review-action-state"
          data-status={reviewState.status}
          data-decision={reviewState.decision ?? undefined}
        >
          {reviewStateText(locale, reviewState.status)}
        </p>
      ) : null}

      {proposal && proposal.reviewDecision !== "pending" ? (
        <div
          className="space-y-2 rounded-ctl border border-ok/30 bg-ok-weak px-3 py-3 text-sm text-fg"
          data-testid="canonical-gemini-review-final"
          data-review-decision={proposal.reviewDecision}
        >
          <h4 className="font-semibold">{copy.finalTitle}</h4>
          <p>
            {copy[proposal.reviewDecision]} · {copy.by}: {roleLabel(proposal.reviewedByRole)} · {copy.at}: {reviewedAtLabel(proposal.reviewedAt, locale)}
          </p>
          {proposal.reviewedText !== null &&
          proposal.reviewedText !== proposal.proposalText ? (
            <div>
              <p className="font-semibold">{copy.finalText}</p>
              <p
                className="mt-1 whitespace-pre-wrap"
                data-testid="canonical-gemini-review-final-text"
              >
                {proposal.reviewedText}
              </p>
            </div>
          ) : null}
          {proposal.reviewReason ? (
            <p data-testid="canonical-gemini-review-final-reason">
              <span className="font-semibold">{copy.reason}:</span>{" "}
              {proposal.reviewReason}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
