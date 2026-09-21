import Link from "next/link";
import { notFound } from "next/navigation";
import { ProgramSubmissionEvidence } from "@/components/portal/admissionPreparations/ProgramDocumentEvidence";
import styles from "@/components/portal/admissionPreparations/ProgramDocuments.module.css";
import { getLocale } from "@/lib/i18n";
import { universityUuid } from "@/lib/platform-university-catalog";
import { readStudentApplicationDocumentNotification } from "@/lib/portal/application-documents-source";
import { getPortalStrings } from "@/lib/portal/i18n";
import { requireStudentPortalActor } from "@/lib/student-portal-guards";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const strings = getPortalStrings("admission", await getLocale());
  return { title: `${strings.targetProgramDocument} — EVO Admissions` };
}

export default async function ProgramDocumentNotificationPage({ params }: {
  params: Promise<{ notificationId: string }>;
}) {
  const [actor, locale, route] = await Promise.all([requireStudentPortalActor(), getLocale(), params]);
  const notificationId = universityUuid(route.notificationId) ?? notFound();
  const strings = getPortalStrings("programDocuments", locale);
  const admission = getPortalStrings("admission", locale);
  // The ordinary RPC proves recipient, case and exact source review. The URL's
  // notification ID never grants authority over an arbitrary file/version.
  const result = await readStudentApplicationDocumentNotification(notificationId).catch(() => null);
  if (result && result.studentCaseId !== actor.studentCaseId) notFound();
  return <main className="pt-page">
    <Link className="pt-link" href="/portal/notifications">{admission.replyAllNotifications}</Link>
    <header className="pt-page-header"><h1 className="pt-page-title">{admission.targetProgramDocument}</h1></header>
    {!result ? <><p className="pt-prep-error" role="alert">{strings.readUnavailable}</p>
      <Link className="pt-btn-ghost" href={`/portal/document-notifications/${notificationId}`}>{strings.refresh}</Link></> : <div className={`${styles.root} ${styles.portal}`}>
      <p className={styles.note}>{strings.notificationSnapshot}</p>
      <ProgramSubmissionEvidence submission={result.submission} target={{ studentCaseId: result.studentCaseId,
        applicationId: result.applicationId, requirementsRevisionId: result.requirementsRevisionId,
        requirementItemId: result.requirementItemId, documentSlotId: result.documentSlotId }} audience="student" strings={strings} />
      <Link className={styles.link} href={`/portal/preparations/${result.applicationId}#requirement-${result.requirementItemId}`}>{strings.openProgram}</Link>
    </div>}
  </main>;
}
