import Link from "next/link";
import type { UniversityFormMappingMetadata } from "@/lib/university-form-registry";
import { universityFormManagement as words } from "@/lib/v3/wording";

export function UniversityFormMappingHistory({ base, templateId, versionId, mappings, selectedId, before, next }: {
  base: string; templateId: string; versionId: string; mappings: readonly UniversityFormMappingMetadata[];
  selectedId?: string; before: number | null; next: number | null;
}) {
  const versionUrl = `${base}?template=${templateId}&version=${versionId}`;
  const link = "inline-flex min-h-11 items-center rounded-ctl px-3 py-2 text-sm text-fg-2 hover:bg-surface-2";
  return <details className="border-t border-border pt-4" open={before !== null}>
    <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-fg">{words.history}</summary>
    <ul className="space-y-1">{mappings.map(mapping => <li key={mapping.id}>
      <Link prefetch={false} href={`${versionUrl}${before !== null ? `&before_mapping=${before}` : ""}&mapping=${mapping.id}`}
        aria-current={selectedId === mapping.id ? "page" : undefined} className={link}>
        {new Intl.DateTimeFormat("ru", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(mapping.created_at))}
        {" · "}{words.mappingCount} {mapping.mappings.length}{" · "}
        {mapping.review?.decision === "approved" ? words.mappingApproved : mapping.review?.decision === "rejected" ? words.mappingRejected : words.mappingPending}
      </Link>
    </li>)}</ul>
    {next !== null ? <Link prefetch={false} href={`${versionUrl}&before_mapping=${next}`} className={link}>{words.older}</Link> : null}
    {before !== null ? <Link prefetch={false} href={versionUrl} className={link}>{words.latestMapping}</Link> : null}
  </details>;
}
