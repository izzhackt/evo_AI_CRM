import { notFound } from "next/navigation";
import { Card } from "@/components/ui";
import { ConversationsMain } from "@/components/v3/ConversationsMain";
import { CaseChatWorkspace, type CaseChatCaseFacts, type CaseChatSnippets } from "@/components/v3/case-chat/CaseChatThread";
import { DIRECTION_LABELS } from "@/components/v3/profile/admissions-view";
import { staffCan } from "@/lib/platform-access";
import { requireV3PageActor } from "@/lib/platform-guards";
import { CASE_CHAT_FAILURE_COPY, caseChatHref, caseChatUuid, parseCaseChatAttachParam, parseCaseChatQueue } from "@/lib/platform-case-chat-contract";
import { getPlatformStudentCaseView } from "@/lib/platform-admissions";
import { CaseChatReadError, readCaseChatPage, readStaffCaseChatQueue } from "@/lib/v3/case-chat-source";
import { readCaseQueueRow } from "@/lib/v3/case-work-source";
import { readLookPreview } from "@/lib/v3/look-preview";
import { conversationChannels } from "@/lib/v3/navigation";
import { readV3ReplySnippets } from "@/lib/v3/reply-snippets-source";
import { getSupabasePublicConfig } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";
export const metadata = { title: "Переписки" };
const TITLE = "Переписки";

/**
 * «Переписки» → «Кабинет студента» (Э5 плана редизайна, 27.09.2026):
 * переписка по делу со студентом. Заголовок «Переписки» и вкладки каналов —
 * общая со страницей WhatsApp шапка `ConversationsMain`; очереди, шапка
 * переписки и шаблоны — в `CaseChatWorkspace`. Права — прежние: страница `admissions.read`, чтения и
 * команды проверяет база.
 */
export default async function MessagesPage({ searchParams }: {
  searchParams: Promise<{ case?: string | string[]; q?: string | string[]; queue?: string | string[]; attach?: string | string[] }>;
}) {
  const actor = await requireV3PageActor("/v3/messages");
  const params = await searchParams;
  const rawCase = typeof params.case === "string" ? params.case : null;
  const query = typeof params.q === "string" ? params.q : null;
  const attach = typeof params.attach === "string" ? params.attach : null;
  const queue = parseCaseChatQueue(params.queue);
  if (queue === null) notFound();
  if (rawCase !== null && !caseChatUuid(rawCase)) notFound();
  const channels = conversationChannels(actor);

  let queueRead: Awaited<ReturnType<typeof readStaffCaseChatQueue>> | null = null;
  let threadsFailure: keyof typeof CASE_CHAT_FAILURE_COPY = "unavailable";
  try {
    queueRead = await readStaffCaseChatQueue(actor, query, queue);
  } catch (error) {
    threadsFailure = error instanceof CaseChatReadError ? error.status : "unavailable";
  }

  if (!queueRead) {
    return <ConversationsMain title={TITLE} channels={channels} current="cabinet" height="window">
      <Card>
        <p role="alert">{threadsFailure === "forbidden" ? "Доступ к перепискам изменился. Обновите страницу." : "Не удалось загрузить переписки. Обновите страницу."}</p>
        <a className="mt-4 inline-flex min-h-11 items-center text-accent-text underline" href={caseChatHref(query ?? "", queue, rawCase, parseCaseChatAttachParam(attach))}>Обновить страницу</a>
      </Card>
    </ConversationsMain>;
  }

  let initialPage: Awaited<ReturnType<typeof readCaseChatPage>> | null = null;
  let pageFailure: keyof typeof CASE_CHAT_FAILURE_COPY | null = null;
  const listed = queueRead.list.rows.find((row) => row.studentCaseId === rawCase) ?? null;
  let studentDisplayName = listed?.studentDisplayName ?? null;
  // Список «Кабинета студента» — только дела в работе (чтение 234).
  let caseState: "pending" | "active" | "closed" = "active";
  let caseFacts: CaseChatCaseFacts | null = null;
  let snippets: CaseChatSnippets = null;
  const look = (await readLookPreview(actor)) ? "next" as const : undefined;
  if (rawCase) {
    try {
      initialPage = await readCaseChatPage(actor, rawCase, "latest");
      if (studentDisplayName === null) {
        // A direct link may point outside the selected queue or the list bound.
        // Reuse the authorized case read; never search an unfiltered first page.
        const view = await getPlatformStudentCaseView(actor, rawCase);
        if (!view || view.access !== "full") throw new CaseChatReadError("forbidden");
        studentDisplayName = view.studentCase.studentDisplayName;
        caseState = view.studentCase.state;
      }
    } catch (error) {
      initialPage = null;
      pageFailure = error instanceof CaseChatReadError ? error.status : "unavailable";
    }
    const name = studentDisplayName;
    const [row, snippetRead] = await Promise.all([
      // Направление и этап — строка очереди 241, как у шапки дела; нет строки — нет фактов.
      name !== null && initialPage !== null
        ? readCaseQueueRow(actor, { studentCaseId: rawCase, studentDisplayName: name, state: caseState })
        : Promise.resolve(null),
      // Шаблоны — то же чтение и то же право, что у WhatsApp; вставляются без отправки.
      initialPage !== null && staffCan(actor, "snippets.read")
        ? readV3ReplySnippets(actor).then(
          (items): CaseChatSnippets => ({ status: "ready", items: items.map(({ replySnippetId, title, body }) => ({ replySnippetId, title, body })) }),
          (): CaseChatSnippets => ({ status: "unavailable" }),
        )
        : Promise.resolve(null),
    ]);
    caseFacts = row ? { direction: row.admissionsDirection ? DIRECTION_LABELS[row.admissionsDirection] : null, stage: row.pipelineStage } : null;
    snippets = snippetRead;
  }

  const realtimeConfig = getSupabasePublicConfig();
  return (
    <ConversationsMain title={TITLE} channels={channels} current="cabinet" height="window" threadOpen={rawCase !== null}>
      <CaseChatWorkspace
        key={`${actor.membershipId}:${rawCase ?? "list"}`}
        organizationId={actor.organizationId}
        membershipId={actor.membershipId}
        realtimeConfig={realtimeConfig}
        initialQueue={queueRead}
        initialStudentDisplayName={studentDisplayName}
        selectedCaseId={rawCase}
        initialPage={initialPage}
        initialPageFailure={pageFailure}
        caseFacts={caseFacts}
        snippets={snippets}
        look={look}
      />
    </ConversationsMain>
  );
}
