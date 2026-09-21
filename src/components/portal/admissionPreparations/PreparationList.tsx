import Link from "next/link";
import type { CatalogPreparation } from "@/lib/portal/catalog-preparations";
import type { PortalStrings } from "@/lib/portal/i18n";

export function PreparationList({ items, strings }: {
  items: readonly CatalogPreparation[] | null;
  strings: PortalStrings<"preparations">;
}) {
  return <section className="pt-prep-list-section" aria-labelledby="selected-programs-title">
    <div className="pt-prep-section-heading"><h2 id="selected-programs-title" className="pt-section-title">{strings.title}</h2>
      <Link className="pt-link" href="/portal/universities">{strings.catalog}</Link>
    </div>
    <p className="pt-prep-note">{strings.lead}</p>
    {items === null ? <p className="pt-prep-error" role="status">{strings.listUnavailable}</p> : items.length === 0 ? <p className="pt-prep-empty">{strings.empty}</p> :
      <ul className="pt-prep-list">{items.map((item) => {
        const program = item.content.programs.find((program) => program.id === item.programId);
        const intake = program?.intakes.find((intake) => intake.id === item.intakeId);
        return <li key={item.applicationId} className="pt-prep-list-row">
          <div className="pt-prep-summary"><p className="pt-prep-university">{item.content.name}</p>
            <h3><Link href={`/portal/preparations/${item.applicationId}`}>{program?.title ?? item.content.name}</Link></h3>
            {intake ? <p className="pt-prep-note">{intake.label}</p> : null}
            <p className="pt-prep-application-status">{strings[`status.${item.applicationStatus}`]}</p>
            {item.deadlineStateAtSelection === "needs_confirmation" ? <p className="pt-prep-note">{strings.savedDeadline}</p> : null}
          </div>
          <Link className="pt-btn-ghost" href={`/portal/preparations/${item.applicationId}`} aria-label={`${strings.open}: ${program?.title ?? item.content.name}`}>{strings.open}</Link>
        </li>;
      })}</ul>}
  </section>;
}
