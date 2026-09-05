import { randomUUID } from "node:crypto";

import { notFound } from "next/navigation";

import { CanonicalAmoCrmCommandPanel } from "@/components/platform/amocrm/CanonicalAmoCrmCommandPanel";
import { Inbox } from "@/components/v3/Inbox";
import { InboxProviderWorkflowControls } from "@/components/v3/InboxProviderWorkflowControls";
import { PartShell } from "@/components/v3/PartShell";
import { getLocale } from "@/lib/i18n";
import {
  parsePlatformConversationCursor,
  parsePlatformRouteUuid,
  type PlatformConversationCursor,
} from "@/lib/platform-communications";
import { requireV3PageActor } from "@/lib/platform-guards";
import {
  readInbox,
  type InboxAmoCrmCommand,
} from "@/lib/v3/inbox-source";
import { v3InboxProfileHref } from "@/lib/v3/inbox-profile-link";

export const dynamic = "force-dynamic";
export const metadata = { title: "V3 · Входящие" };

type SearchParams = Readonly<{
  conversation?: string | string[];
  before_at?: string | string[];
  before_id?: string | string[];
  messages_before_at?: string | string[];
  messages_before_id?: string | string[];
}>;

const AMOCRM_BLOCKED_COPY: Readonly<
  Record<Extract<InboxAmoCrmCommand, { status: "blocked" }>["reason"], string>
> = Object.freeze({
  canonical_scope_missing:
    "Синхронизация с amoCRM недоступна: диалог ещё не связан с точным лидом, клиентом или делом в EVO.",
  role_scope_mismatch:
    "Синхронизация с amoCRM недоступна для текущей рабочей роли.",
  canonical_runtime_unavailable:
    "Синхронизация с amoCRM временно недоступна. Запись через другой путь не выполняется.",
});

export default async function InboxPart({
  searchParams,
}: Readonly<{ searchParams: Promise<SearchParams> }>) {
  const [query, actor, locale] = await Promise.all([
    searchParams,
    requireV3PageActor("/v3/inbox"),
    getLocale(),
  ]);
  assertExpectedQueryKeys(query);
  const conversationId = parseConversationId(query.conversation);
  const queueCursor = parseCursor(query.before_at, query.before_id);
  const messageCursor = parseCursor(
    query.messages_before_at,
    query.messages_before_id,
  );
  if (conversationId === null && messageCursor !== null) notFound();

  const model = await readInbox(actor, {
    conversationId,
    queueCursor,
    messageCursor,
  });
  const { view } = model;
  if (conversationId !== null && view.selected === null) notFound();

  let workflowControls = null;
  let amoCrmControls = null;
  let profileHref: string | null = null;
  if (view.selected) {
    if (model.providerWorkflow === null || model.amoCrmCommand === null) {
      throw new Error("V3 inbox command state is unavailable.");
    }
    const selected = view.selected;
    const provider = model.providerWorkflow;
    workflowControls = (
      <InboxProviderWorkflowControls
        key={`${provider.proposal?.proposalRequestId ?? "no-proposal"}:${
          provider.reviews.find(
            (review) =>
              review.proposalRequestId === provider.proposal?.proposalRequestId,
          )?.reviewId ?? "unreviewed"
        }:${provider.latestAttempt?.attemptId ?? "no-attempt"}`}
        conversationId={selected.id}
        latestInboundSourceMessageId={selected.latestInboundSourceMessageId}
        proposal={provider.proposal}
        reviews={provider.reviews}
        latestAttempt={provider.latestAttempt}
        requestIds={{
          gemini: randomUUID(),
          review: randomUUID(),
          send: randomUUID(),
          reconcile: randomUUID(),
        }}
      />
    );
    amoCrmControls = renderAmoCrmControls(model.amoCrmCommand, locale);
    profileHref = v3InboxProfileHref(
      actor.presentationRole,
      selected.canonicalContext,
    );
  }

  return (
    <PartShell title="Входящие" count={view.conversations.length} fill>
      <Inbox
        view={view}
        profileHref={profileHref}
        workflowControls={workflowControls}
        amoCrmControls={amoCrmControls}
      />
    </PartShell>
  );
}

function renderAmoCrmControls(
  command: InboxAmoCrmCommand,
  locale: Awaited<ReturnType<typeof getLocale>>,
) {
  if (command.status === "blocked") {
    return (
      <section
        className="rounded-ctl bg-warn-weak px-3 py-3 text-sm text-warn"
        data-testid="v3-inbox-amocrm"
        data-status="unavailable"
        role="status"
      >
        {AMOCRM_BLOCKED_COPY[command.reason]}
      </section>
    );
  }

  return (
    <div data-testid="v3-inbox-amocrm" data-status="available">
      <CanonicalAmoCrmCommandPanel
        availability={command.availability}
        blockingAttempt={command.blockingAttempt}
        scope={command.scope}
        leadId={command.leadId}
        studentCaseId={command.studentCaseId}
        locale={locale}
        requestId={randomUUID()}
      />
    </div>
  );
}

function assertExpectedQueryKeys(params: SearchParams): void {
  const allowed = new Set([
    "conversation",
    "before_at",
    "before_id",
    "messages_before_at",
    "messages_before_id",
  ]);
  if (Object.keys(params).some((key) => !allowed.has(key))) notFound();
}

function parseConversationId(raw: string | string[] | undefined): string | null {
  const value = singleValue(raw);
  if (value === undefined) return null;
  const conversationId = parsePlatformRouteUuid(value);
  if (conversationId === null) notFound();
  return conversationId;
}

function parseCursor(
  rawSortAt: string | string[] | undefined,
  rawId: string | string[] | undefined,
): PlatformConversationCursor | null {
  const sortAt = singleValue(rawSortAt);
  const id = singleValue(rawId);
  if (sortAt === undefined && id === undefined) return null;
  if (sortAt === undefined || id === undefined) notFound();
  const cursor = parsePlatformConversationCursor(sortAt, id);
  if (cursor === null) notFound();
  return cursor;
}

function singleValue(
  value: string | string[] | undefined,
): string | undefined {
  if (Array.isArray(value)) notFound();
  return value;
}
