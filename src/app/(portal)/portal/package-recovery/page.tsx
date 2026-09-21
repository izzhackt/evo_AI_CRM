import Link from "next/link";
import { PackageOwnerRecovery } from "@/components/portal/applicationPackages/PackageRecovery";
import { packageStrings } from "@/components/portal/applicationPackages/strings";
import styles from "@/components/portal/admissionPreparations/ProgramDocuments.module.css";
import { getLocale } from "@/lib/i18n";
import { requireStudentPortalActor } from "@/lib/student-portal-guards";
export const dynamic = "force-dynamic";
export async function generateMetadata() { return { title: `${packageStrings(await getLocale()).pendingTitle} — EVO Admissions` }; }
export default async function PackageRecoveryPage() {
  const [actor, locale] = await Promise.all([requireStudentPortalActor(), getLocale()]);
  const strings = packageStrings(locale);
  return <main className="pt-page"><Link className="pt-link" href="/portal">{strings.backPrograms}</Link>
    <header className="pt-page-header"><h1 className="pt-page-title">{strings.pendingTitle}</h1></header>
    <div className={`${styles.root} ${styles.portal}`}><PackageOwnerRecovery owner={{ organizationId: actor.organizationId, membershipId: actor.membershipId }} audience="student" strings={strings} showEmpty /></div>
  </main>;
}
