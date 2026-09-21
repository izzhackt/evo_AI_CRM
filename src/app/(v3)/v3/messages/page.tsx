import { notFound } from "next/navigation";
import { Card } from "@/components/ui";
import { PartShell } from "@/components/v3/PartShell";
import { CaseChatWorkspace } from "@/components/v3/case-chat/CaseChatThread";
import { requireV3PageActor } from "@/lib/platform-guards";
import { CASE_CHAT_FAILURE_COPY, caseChatHref, caseChatUuid, parseCaseChatAttachParam, parseCaseChatQueue } from "@/lib/platform-case-chat-contract";
import { getPlatformStudentCaseView } from "@/lib/platform-admissions";
import { CaseChatReadError, readCaseChatPage, readStaffCaseChatThreads } from "@/lib/v3/case-chat-source";
import { getSupabasePublicConfig } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";
export const metadata = { title: "EVO · Сообщения" };

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

  let threads: Awaited<ReturnType<typeof readStaffCaseChatThreads>> | null = null;
  let threadsFailure: keyof typeof CASE_CHAT_FAILURE_COPY = "unavailable";
  try {
    threads = await readStaffCaseChatThreads(actor, query, queue);
  } catch (error) {
    threadsFailure = error instanceof CaseChatReadError ? error.status : "unavailable";
  }

  if (!threads) {
    return <PartShell title="Сообщения"><Card>
      <p role="alert">{threadsFailure === "forbidden" ? "Доступ к перепискам изменился. Обновите страницу." : "Не удалось загрузить переписки. Обновите страницу."}</p>
      <a className="mt-4 inline-flex min-h-11 items-center text-accent-text underline" href={caseChatHref(query ?? "", queue, rawCase, parseCaseChatAttachParam(attach))}>Обновить страницу</a>
    </Card></PartShell>;
  }

  let initialPage: Awaited<ReturnType<typeof readCaseChatPage>> | null = null;
  let pageFailure: keyof typeof CASE_CHAT_FAILURE_COPY | null = null;
  let studentDisplayName = threads.rows.find((row) => row.studentCaseId === rawCase)?.studentDisplayName ?? null;
  if (rawCase) {
    try {
      initialPage = await readCaseChatPage(actor, rawCase, "latest");
      if (studentDisplayName === null) {
        // A direct link may point outside the selected queue or the list bound.
        // Reuse the authorized case read; never search an unfiltered first page.
        const view = await getPlatformStudentCaseView(actor, rawCase);
        if (!view || view.access !== "full") throw new CaseChatReadError("forbidden");
        studentDisplayName = view.studentCase.studentDisplayName;
      }
    } catch (error) {
      initialPage = null;
      pageFailure = error instanceof CaseChatReadError ? error.status : "unavailable";
    }
  }

  const realtimeConfig = getSupabasePublicConfig();
  return (
    <main className="flex h-[calc(100dvh-150px)] min-h-0 flex-col md:h-[calc(100dvh-64px)]" aria-label="Сообщения">
      <CaseChatWorkspace
        key={`${actor.membershipId}:${rawCase ?? "list"}`}
        organizationId={actor.organizationId}
        membershipId={actor.membershipId}
        realtimeConfig={realtimeConfig}
        initialThreads={threads}
        initialQuery={query ?? ""}
        initialQueue={queue}
        initialStudentDisplayName={studentDisplayName}
        selectedCaseId={rawCase}
        initialPage={initialPage}
        initialPageFailure={pageFailure}
        pendingAttachment={parseCaseChatAttachParam(attach)}
      />
    </main>
  );
}
