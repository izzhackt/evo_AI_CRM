import Link from "next/link";
import { notFound } from "next/navigation";
import { PackageDecision, PackageDetailLoader } from "@/components/portal/applicationPackages/PackageDetail";
import { packageStrings } from "@/components/portal/applicationPackages/strings";
import styles from "@/components/portal/admissionPreparations/ProgramDocuments.module.css";
import { getLocale } from "@/lib/i18n";
import { universityUuid } from "@/lib/platform-university-catalog";
import { readStudentApplicationPackageNotification } from "@/lib/portal/application-packages-source";
import { getPortalStrings } from "@/lib/portal/i18n";
import { requireStudentPortalActor } from "@/lib/student-portal-guards";
export const dynamic = "force-dynamic";
export async function generateMetadata() { return { title: `${packageStrings(await getLocale()).notificationTitle} — EVO Admissions` }; }
export default async function PackageNotificationPage({ params }: { params: Promise<{ notificationId: string }> }) {
  const [actor, locale, route] = await Promise.all([requireStudentPortalActor(), getLocale(), params]);
  const notificationId = universityUuid(route.notificationId) ?? notFound(), strings = packageStrings(locale);
  const result = await readStudentApplicationPackageNotification(notificationId).catch(() => null);
  if (result && result.studentCaseId !== actor.studentCaseId) notFound();
  return <main className="pt-page"><Link className="pt-link" href="/portal/notifications">{strings.backNotifications}</Link>
    <header className="pt-page-header"><h1 className="pt-page-title">{strings.notificationTitle}</h1></header>
    {!result ? <><p className="pt-prep-error" role="alert">{strings.unavailable}</p><Link className="pt-btn-ghost" href={`/portal/package-notifications/${notificationId}`}>{strings.refresh}</Link></> : <div className={`${styles.root} ${styles.portal}`}>
      <PackageDecision review={result.review} strings={strings} />
      <PackageDetailLoader scope={{ organizationId: actor.organizationId, membershipId: actor.membershipId, studentCaseId: result.studentCaseId, applicationId: result.applicationId }} packageId={result.packageId}
        audience="student" strings={strings} documentStrings={getPortalStrings("programDocuments", locale)} frozenReview={result.review} showDecision={false} />
      <Link className={styles.link} href={`/portal/preparations/${result.applicationId}`}>{strings.openProgram}</Link>
    </div>}
  </main>;
}
