import Link from "next/link";
import { notFound } from "next/navigation";
import { ApplicationRequirementsUI } from "@/components/portal/admissionPreparations/ApplicationRequirementsUI";
import { getLocale } from "@/lib/i18n";
import { universityUuid } from "@/lib/platform-university-catalog";
import { getPortalStrings } from "@/lib/portal/i18n";
import { universityDateLabel } from "@/lib/portal/universities";
import { readStudentCatalogPreparations } from "@/lib/portal/catalog-preparations-source";
import { readStudentApplicationDocuments } from "@/lib/portal/application-documents-source";
import { requireStudentPortalActor } from "@/lib/student-portal-guards";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const strings = getPortalStrings("preparations", await getLocale());
  return { title: `${strings.requirements} — EVO Admissions` };
}

export default async function StudentPreparationPage({ params }: { params: Promise<{ applicationId: string }> }) {
  const [actor, route, locale] = await Promise.all([requireStudentPortalActor(), params, getLocale()]);
  const applicationId = universityUuid(route.applicationId)?.toLowerCase() ?? notFound();
  const strings = getPortalStrings("preparations", locale);
  const documentStrings = getPortalStrings("programDocuments", locale);
  const universityStrings = getPortalStrings("universities", locale);
  // A foreign/absent application is not exposed by another reader or Finance.
  const preparations = await readStudentCatalogPreparations(actor.studentCaseId).catch(() => null);
  if (preparations === null) return <main className="pt-page"><Link className="pt-link" href="/portal">{strings.back}</Link>
    <h1 className="pt-page-title">{strings.requirements}</h1><p className="pt-prep-error" role="status">{strings.listUnavailable}</p>
    <Link className="pt-btn-ghost" href={`/portal/preparations/${applicationId}`}>{strings.refresh}</Link>
  </main>;
  const saved = preparations.find((item) => item.applicationId === applicationId) ?? notFound();
  const program = saved.content.programs.find((item) => item.id === saved.programId);
  const intake = program?.intakes.find((item) => item.id === saved.intakeId);
  const documents = await readStudentApplicationDocuments(actor.studentCaseId, applicationId).catch(() => null);
  return <main className="pt-page pt-prep-detail">
    <Link className="pt-link" href="/portal">{strings.back}</Link>
    <header className="pt-page-header">
      <p className="pt-prep-university">{saved.content.name}</p>
      <h1 className="pt-page-title">{program?.title ?? saved.content.name}</h1>
      {intake ? <p className="pt-page-lead">{intake.label}</p> : null}
      <p className="pt-prep-application-status">{strings[`status.${saved.applicationStatus}`]}</p>
      <p className="pt-prep-note">{strings.saved}</p>
      <p className="pt-prep-note">{strings.savedFacts}</p>
      {intake?.applicationDeadline ? <dl className="pt-facts"><div className="pt-fact">
        <dt>{universityStrings.intakeDeadline}</dt>
        <dd className="pt-data"><time dateTime={intake.applicationDeadline}>{universityDateLabel(intake.applicationDeadline, locale)}</time>
          {intake.deadlineTime ? `, ${intake.deadlineTime}` : ""}{intake.timezone ? ` (${intake.timezone})` : ""}
        </dd>
      </div></dl> : null}
      {saved.deadlineStateAtSelection === "needs_confirmation" ? <p className="pt-prep-note">{strings.savedDeadline}</p> : null}
    </header>
    <ApplicationRequirementsUI key={`${actor.organizationId}:${actor.membershipId}:${actor.studentCaseId}:${applicationId}`} scope={{ organizationId: actor.organizationId, membershipId: actor.membershipId, studentCaseId: actor.studentCaseId }}
      applicationId={applicationId} initial={documents}
      canInitialize={actor.caseState === "active" && Boolean(actor.portalActivatedAt) && saved.applicationStatus === "preparation"}
      strings={strings} documentStrings={documentStrings}/>
  </main>;
}
