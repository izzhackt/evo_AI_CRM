"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";

import { btnCls, cn } from "@/components/ui";
import type { Locale } from "@/lib/i18n";
import type { CanonicalGeminiProposalAvailability } from "@/lib/server/canonical-gemini-proposal-config";
import {
  requestCanonicalGeminiProposalAction,
  type CanonicalGeminiProposalActionState,
} from "@/lib/server/canonical-gemini-proposal-actions";

const COPY = {
  ru: {
    title: "Черновик Gemini · только для проверки человеком",
    description:
      "Gemini может подготовить ответ по этой канонической переписке. Черновик сохраняется в EVO, но никогда не отправляется автоматически.",
    request: "Проверить и запросить черновик",
    pending: "Проверяем доступ…",
    latest: "Последний сохранённый черновик",
    noDraft: "Сохранённого черновика пока нет.",
    created: "Черновик сохранён в EVO и ожидает отдельного human review.",
    blocked: "Вызов Gemini заблокирован настройками этого контура.",
    error: "Черновик не создан. EVO ничего не сохранил.",
    feature_disabled: "Функция Gemini выключена.",
    provider_not_authorized: "Отдельное разрешение на реальный вызов Gemini не выдано.",
    configuration_missing: "Не хватает server-only ключа или явно заданной модели.",
    configuration_invalid: "Настройки Gemini некорректны.",
  },
  ky: {
    title: "Gemini долбоору · адам текшерүүсү үчүн гана",
    description:
      "Gemini ушул каноникалык кат алышуу боюнча жооп долбоорун даярдай алат. Долбоор EVO'до сакталат, бирок автоматтык жөнөтүлбөйт.",
    request: "Текшерип, долбоор сураңыз",
    pending: "Жеткиликтүүлүк текшерилүүдө…",
    latest: "Акыркы сакталган долбоор",
    noDraft: "Сакталган долбоор азырынча жок.",
    created: "Долбоор EVO'до сакталды жана адамдын кароосун күтөт.",
    blocked: "Gemini чакыруусу бул контурдун жөндөөлөрү менен бөгөттөлгөн.",
    error: "Долбоор түзүлгөн жок. EVO эч нерсе сактаган жок.",
    feature_disabled: "Gemini функциясы өчүрүлгөн.",
    provider_not_authorized: "Gemini'ни чыныгы чакырууга өзүнчө уруксат берилген жок.",
    configuration_missing: "Server-only ачкыч же так көрсөтүлгөн модель жетишпейт.",
    configuration_invalid: "Gemini жөндөөлөрү туура эмес.",
  },
  en: {
    title: "Gemini draft · human review only",
    description:
      "Gemini can prepare a reply from this canonical transcript. EVO stores the draft, but never sends it automatically.",
    request: "Check and request draft",
    pending: "Checking access…",
    latest: "Latest persisted draft",
    noDraft: "There is no persisted draft yet.",
    created: "The draft is stored in EVO and awaits separate human review.",
    blocked: "The Gemini call is blocked by this environment's settings.",
    error: "No draft was created. EVO stored nothing.",
    feature_disabled: "The Gemini feature is disabled.",
    provider_not_authorized: "A separate authorization for a real Gemini call was not granted.",
    configuration_missing: "The server-only key or explicitly configured model is missing.",
    configuration_invalid: "The Gemini configuration is invalid.",
  },
} as const;

type Proposal = Readonly<{
  proposalId: string;
  model: string;
  proposalText: string;
  sourceMessageId: string;
  reviewDecision: "pending" | "accepted" | "edited" | "rejected";
}>;

const INITIAL_STATE: CanonicalGeminiProposalActionState = Object.freeze({
  status: "idle",
  reason: null,
  proposalId: null,
});

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

export function CanonicalGeminiProposalPanel({
  locale,
  conversationId,
  availability,
  proposal,
}: Readonly<{
  locale: Locale;
  conversationId: string;
  availability: CanonicalGeminiProposalAvailability;
  proposal: Proposal | null;
}>) {
  const copy = COPY[locale];
  const router = useRouter();
  const [state, action, pending] = useActionState(
    requestCanonicalGeminiProposalAction,
    INITIAL_STATE,
  );

  useEffect(() => {
    if (state.status === "created") router.refresh();
  }, [router, state.status]);

  return (
    <section
      className="space-y-3 rounded-card border border-border bg-surface-2 p-4"
      data-testid="canonical-gemini-proposal-panel"
    >
      <div>
        <h3 className="text-[15px] font-semibold text-fg">{copy.title}</h3>
        <p className="mt-1 text-[13px] leading-6 text-fg-3">{copy.description}</p>
      </div>

      <div
        className={cn(
          "rounded-control border px-3 py-2 text-[13px]",
          availability.status === "ready"
            ? "border-success/30 bg-success-weak text-success"
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

      <form action={action}>
        <input type="hidden" name="conversation_id" value={conversationId} />
        <button
          type="submit"
          className={btnCls}
          disabled={pending}
          data-testid="canonical-gemini-proposal-request"
        >
          {pending ? copy.pending : copy.request}
        </button>
      </form>

      {state.status !== "idle" ? (
        <p
          className="text-[13px] leading-6 text-fg-2"
          data-testid="canonical-gemini-proposal-action-state"
          data-status={state.status}
          data-reason={state.reason ?? undefined}
        >
          {state.status === "created"
            ? copy.created
            : state.status === "blocked"
              ? `${copy.blocked} ${reasonText(locale, state.reason)}`
              : copy.error}
        </p>
      ) : null}

      <div>
        <h4 className="text-[13px] font-semibold text-fg">{copy.latest}</h4>
        {proposal ? (
          <blockquote
            className="mt-2 whitespace-pre-wrap rounded-control border border-border bg-surface px-3 py-3 text-[13.5px] leading-6 text-fg"
            data-testid="canonical-gemini-proposal-latest"
            data-proposal-id={proposal.proposalId}
            data-source-message-id={proposal.sourceMessageId}
            data-review-decision={proposal.reviewDecision}
          >
            {proposal.proposalText}
          </blockquote>
        ) : (
          <p className="mt-2 text-[13px] text-fg-3">{copy.noDraft}</p>
        )}
      </div>
    </section>
  );
}
