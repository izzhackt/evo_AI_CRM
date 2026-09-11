import Link from "next/link";
import { notFound } from "next/navigation";

import { PortalPage, PortalSection } from "@/components/v3/portal/PortalPage";
import { PortalNotificationReadButton } from "@/components/v3/portal/PortalNotificationReadButton";
import { formatPortalTimestamp } from "@/components/v3/portal/presentation";
import { caseOperationUuid } from "@/lib/platform-admissions-support-contract";
import { markStudentPortalNotificationReadAction } from "@/lib/student-portal-actions";
import { requireStudentPortalActor } from "@/lib/student-portal-guards";
import { readStudentHelpReply } from "@/lib/v3/case-operations-source";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ответ куратора — EVO Admissions" };

export default async function StudentHelpReplyPage({ params }: {
  params: Promise<{ notificationId: string }>;
}) {
  const actor = await requireStudentPortalActor();
  const { notificationId } = await params;
  if (!caseOperationUuid(notificationId)) notFound();
  const { request: reply, readAt } = await readStudentHelpReply(actor, notificationId);

  return (
    <PortalPage title="Ответ куратора" description="Обращение по вашему поступлению.">
      <Link href="/portal/notifications" className="mb-4 inline-flex min-h-11 items-center font-medium text-accent-text underline">
        Все уведомления
      </Link>
      <PortalSection title={reply.subject}>
        <div className="space-y-5 break-words p-4 sm:p-5">
          <div>
            <h3 className="text-sm font-semibold text-fg">Ваш вопрос</h3>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-fg-2">{reply.body}</p>
          </div>
          <div className="border-s-2 border-accent ps-3">
            <h3 className="text-sm font-semibold text-fg">Ответ EVO</h3>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-fg">{reply.answer}</p>
            <p className="mt-2 text-xs text-fg-3">{formatPortalTimestamp(reply.answeredAt)}</p>
          </div>
          {readAt === null ? (
            <form action={markStudentPortalNotificationReadAction}>
              <input type="hidden" name="notification_id" value={notificationId} />
              <PortalNotificationReadButton />
            </form>
          ) : null}
        </div>
      </PortalSection>
    </PortalPage>
  );
}
