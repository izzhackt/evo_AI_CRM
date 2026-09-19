import Link from "next/link";
import { notFound } from "next/navigation";

import { PortalNotificationReadButton } from "@/components/portal/admission/PortalNotificationReadButton";
import { formatPortalTimestamp } from "@/components/portal/admission/presentation";
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
    <main className="pt-page">
      <header className="pt-page-header">
        <p className="pt-page-kicker">Кабинет студента</p>
        <h1 className="pt-page-title">Ответ куратора</h1>
        <p className="pt-page-lead">Обращение по вашему поступлению.</p>
      </header>
      <p>
        <Link href="/portal/notifications" className="pt-link">
          Все уведомления
        </Link>
      </p>
      <section className="pt-card pt-reply-card">
        <header className="pt-card-header">
          <h2 className="pt-card-title">{reply.subject}</h2>
        </header>
        <div className="pt-reply-body">
          <div>
            <h3 className="pt-reply-heading">Ваш вопрос</h3>
            <p className="pt-reply-text">{reply.body}</p>
          </div>
          <div className="pt-reply-answer">
            <h3 className="pt-reply-heading">Ответ EVO</h3>
            <p className="pt-reply-text">{reply.answer}</p>
            <p className="pt-reply-meta">{formatPortalTimestamp(reply.answeredAt)}</p>
          </div>
          {readAt === null ? (
            <form action={markStudentPortalNotificationReadAction}>
              <input type="hidden" name="notification_id" value={notificationId} />
              <PortalNotificationReadButton />
            </form>
          ) : null}
        </div>
      </section>
    </main>
  );
}
