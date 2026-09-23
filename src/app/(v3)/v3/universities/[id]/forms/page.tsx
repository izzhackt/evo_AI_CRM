import { createHash, randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound, redirect, unstable_rethrow } from "next/navigation";
import { PartShell } from "@/components/v3/PartShell";
import { UniversityFormCreate } from "@/components/v3/universities/forms/UniversityFormCreate";
import { UniversityFormUpload } from "@/components/v3/universities/forms/UniversityFormUpload";
import { UniversityFormUploadStatus } from "@/components/v3/universities/forms/UniversityFormUploadStatus";
import { UniversityFormDecision } from "@/components/v3/universities/forms/UniversityFormDecision";
import { UniversityFormMappingEditor } from "@/components/v3/universities/forms/UniversityFormMappingEditor";
import { UniversityPdfMappingEditor } from "@/components/v3/universities/forms/UniversityPdfMappingEditor";
import { UniversityFormMappingHistory } from "@/components/v3/universities/forms/UniversityFormMappingHistory";
import { requireV3PageActor } from "@/lib/platform-guards";
import { isStaffPreview, staffHasPermission } from "@/lib/platform-access";
import { universityUuid } from "@/lib/platform-university-catalog";
import { PlatformUniversityFormError } from "@/lib/platform-university-forms";
import { createUniversityFormAction, reserveUniversityFormVersionAction } from "@/lib/platform-university-form-actions";
import { manageUniversityFormAction } from "@/lib/platform-university-form-management-actions";
import { readStaffUniversities } from "@/lib/v3/university-source";
import { readUniversityFormWorkspace } from "@/lib/v3/university-form-source";
import { universityFormWorkspace as words, universityFormActionMessage } from "@/lib/v3/wording";
import { universityFormManagement as management, universityFormSourceLabel } from "@/lib/v3/wording";

export const dynamic = "force-dynamic";
export const metadata = { title: "Университеты" };
const link = "inline-flex min-h-11 items-center rounded-ctl px-3 py-2 text-sm font-medium text-fg-2 hover:bg-surface-2";
type Query = Record<string, string | string[] | undefined>;
function single(query: Query, key: string): string | undefined {
  const value = query[key]; if (Array.isArray(value)) notFound(); return value;
}
function uuid(query: Query, key: string) { const value = single(query, key); return value === undefined ? null : universityUuid(value) ?? notFound(); }
function before(query: Query, key: string) {
  const value = single(query, key); if (value === undefined) return null;
  if (!/^[1-9]\d{0,15}$/u.test(value) || !Number.isSafeInteger(Number(value))) notFound(); return Number(value);
}

export default async function UniversityFormsPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<Query>;
}) {
  const [actor, route, query] = await Promise.all([requireV3PageActor("/v3/universities"), params, searchParams]);
  const catalogId = universityUuid(route.id) ?? notFound();
  const base = `/v3/universities/${catalogId}/forms`;
  if (isStaffPreview(actor) || !staffHasPermission(actor, "catalog.import.manage")) redirect(`/access-denied?from=${encodeURIComponent(base)}`);
  const templateId = uuid(query, "template"), versionId = uuid(query, "version"), afterId = uuid(query, "after"), mappingId = uuid(query, "mapping");
  const beforeVersion = before(query, "before_version"), beforeMapping = before(query, "before_mapping");
  const create = single(query, "new") === "1", upload = single(query, "upload") === "1", edit = single(query, "edit") === "1";
  if ((create && (templateId || upload || edit)) || (upload && edit) || (mappingId && !versionId)
    || ((edit || upload || versionId || beforeVersion || beforeMapping || mappingId) && !templateId)) notFound();
  let data, university;
  try {
    const [catalogue, forms] = await Promise.all([readStaffUniversities(actor, undefined, catalogId),
      readUniversityFormWorkspace(actor, catalogId, { templateId, versionId, afterId, beforeVersion, beforeMapping })]);
    university = catalogue.items[0] ?? notFound(); data = forms;
  } catch (error) {
    unstable_rethrow(error);
    return <PartShell title={words.title}><div className="space-y-4">
      <Link href={`/v3/universities/${catalogId}`} className={link}>{words.back}</Link>
      <p role="alert" className="max-w-2xl text-sm leading-6 text-fg-2">{error instanceof PlatformUniversityFormError && error.code !== "unavailable" ? universityFormActionMessage(error.code) : words.readUnavailable}</p>
      <a className={link} href={base}>{words.reload}</a>
    </div></PartShell>;
  }
  const { templates, workspace, inspection } = data;
  const selected = workspace?.selected_version;
  const MappingEditor = inspection?.manifest?.format === "pdf" ? UniversityPdfMappingEditor : UniversityFormMappingEditor;
  const mapping = mappingId ? workspace?.mappings.find(item => item.id === mappingId) : workspace?.mappings[0];
  if (mappingId && !mapping) notFound();
  const writable = workspace && workspace.can_manage && !workspace.template.archived && inspection?.source_current !== false;
  const mappingUrl = workspace && selected && mapping ? `${base}?template=${workspace.template.id}&version=${selected.id}${beforeMapping ? `&before_mapping=${beforeMapping}` : ""}&mapping=${mapping.id}` : undefined;
  return <PartShell title={words.title}>
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><Link href={`/v3/universities/${catalogId}`} className={link}>{words.back}</Link><p className="px-3 text-sm text-fg-2">{university.content.name}</p></div>
        {!create ? <Link prefetch={false} href={`${base}?new=1`} className={`${link} border border-border`}>{words.add}</Link> : null}
      </div>
      <div className="grid gap-8 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <nav aria-label={words.title} className="space-y-4 border-b border-border pb-5 lg:border-b-0 lg:border-r lg:pr-5">
          {templates.items.length ? <ul className="space-y-1">{templates.items.map(item => <li key={item.id}>
            <Link prefetch={false} href={`${base}?template=${item.id}`} aria-current={templateId === item.id ? "page" : undefined}
              className="v3-choice block min-h-11 rounded-ctl px-3 py-3 text-fg hover:bg-surface-2">
              <span className="block break-words text-sm font-medium">{item.title}</span>
              <span className="mt-1 block text-sm font-normal text-fg-2">{item.archived ? words.archived : item.publication ? words.published : words.draft}</span>
            </Link>
          </li>)}</ul> : <p className="text-sm text-fg-2">{words.empty}</p>}
          {templates.next_after_id ? <Link href={`${base}?after=${templates.next_after_id}`} className={link}>{words.more}</Link> : null}
          {afterId ? <Link href={base} className={link}>{words.first}</Link> : null}
        </nav>
        <div className="min-w-0 space-y-6">
          {create ? <UniversityFormCreate key="create" catalogId={catalogId} templateId={randomUUID()} requestId={randomUUID()} action={createUniversityFormAction} />
            : workspace ? <>
              <div className="space-y-2"><h2 className="break-words text-xl font-bold text-fg">{workspace.template.title}</h2>
                {workspace.template.archived ? <p className="text-sm text-fg-2">{words.archived}</p> : null}
                {inspection?.source_current === false && !workspace.template.archived ? <p role="alert" className="text-sm text-fg-2">{words.sourceChanged}</p> : null}
              </div>
              {writable && (upload || !selected || (inspection?.inspection === "pending" && !inspection.ingress)) ?
                <UniversityFormUpload key={`${workspace.template.id}:${upload ? "new" : selected?.id ?? "first"}`}
                  catalogId={catalogId} templateId={workspace.template.id} revision={workspace.template.revision}
                  reserveRequestId={randomUUID()} uploadRequestId={randomUUID()} version={upload ? null : selected}
                  action={reserveUniversityFormVersionAction} />
                : selected && !workspace.template.archived ? <UniversityFormUploadStatus key={selected.id} catalogId={catalogId} templateId={workspace.template.id} version={selected} initialInspection={inspection} /> : null}
              {writable && selected && !upload ? <Link prefetch={false} href={`${base}?template=${workspace.template.id}&upload=1`} className={link}>{words.newVersion}</Link> : null}
              {writable && selected && inspection?.inspection === "verified" && inspection.manifest && !upload ?
                !mapping || edit ? <MappingEditor key={`edit:${selected.id}:${mapping?.id ?? "new"}`}
                  catalogId={catalogId} templateId={workspace.template.id} revision={workspace.template.revision} version={selected}
                  manifest={inspection.manifest} manifestDigest={createHash("sha256").update(JSON.stringify(inspection.manifest)).digest("hex")}
                  mappingId={randomUUID()} requestId={randomUUID()} initialMappings={mapping?.mappings ?? []} action={manageUniversityFormAction} />
                  : <Link prefetch={false} href={`${base}?template=${workspace.template.id}&version=${selected.id}${beforeMapping ? `&before_mapping=${beforeMapping}` : ""}&mapping=${mapping.id}&edit=1`} className={link}>{management.edit}</Link> : null}
              {mapping && !upload && !edit ? <div className="space-y-5 border-t border-border pt-5">
                <div className="space-y-2"><h3 className="text-lg font-bold text-fg">{management.mappings}</h3>
                  <p className="text-sm text-fg-2">{management.mappingCount} {mapping.mappings.length} · {mapping.review?.decision === "approved" ? management.mappingApproved : mapping.review?.decision === "rejected" ? management.mappingRejected : management.mappingPending}</p>
                  {!(writable && selected && inspection?.inspection === "verified" && inspection.manifest) ? <ul className="max-h-80 space-y-2 overflow-y-auto pr-2" tabIndex={0} aria-label={management.mappings}>
                    {mapping.mappings.map(field => <li key={field.slotId} className="text-sm leading-6 text-fg">
                      {field.manual ? management.manual : universityFormSourceLabel(field.sourceKey ?? "")} · {field.required ? management.required : management.optional}
                    </li>)}
                  </ul> : null}
                </div>
                {writable && selected && inspection?.inspection === "verified" && inspection.manifest ?
                  <MappingEditor key={`review-context:${selected.id}:${mapping.id}`} readOnly
                    catalogId={catalogId} templateId={workspace.template.id} revision={workspace.template.revision} version={selected}
                    manifest={inspection.manifest} manifestDigest={createHash("sha256").update(JSON.stringify(inspection.manifest)).digest("hex")}
                    mappingId={mapping.id} requestId={randomUUID()} initialMappings={mapping.mappings} action={manageUniversityFormAction} /> : null}
                {writable && inspection?.inspection === "verified" && mapping.review?.decision !== "approved" ? <UniversityFormDecision key={`review:${mapping.id}`}
                  catalogId={catalogId} templateId={workspace.template.id} versionId={selected?.id ?? null} revision={workspace.template.revision}
                  requestId={randomUUID()} decision={{ operation: "review_mapping", mapping }} action={manageUniversityFormAction} returnUrl={mappingUrl} /> : null}
                {writable && inspection?.inspection === "verified" && mapping.review?.decision === "approved" && workspace.publication?.mapping_id !== mapping.id ?
                  <UniversityFormDecision key={`publish:${mapping.id}:${mapping.review.id}`} catalogId={catalogId} templateId={workspace.template.id}
                    versionId={selected?.id ?? null} revision={workspace.template.revision} requestId={randomUUID()}
                    decision={{ operation: "publish", mapping }} action={manageUniversityFormAction} returnUrl={mappingUrl} /> : null}
              </div> : null}
              {selected && (workspace.mappings.length || beforeMapping) ? <UniversityFormMappingHistory base={base} templateId={workspace.template.id}
                versionId={selected.id} mappings={workspace.mappings} selectedId={mapping?.id} before={beforeMapping} next={workspace.next_mapping_before} /> : null}
              {workspace.versions.length ? <details className="border-t border-border pt-4"><summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-fg">{words.versions}</summary>
                <ul className="space-y-1">{workspace.versions.map(version => <li key={version.id}>
                  <Link prefetch={false} href={`${base}?template=${workspace.template.id}&version=${version.id}`} className={`v3-choice ${link}`} aria-current={selected?.id === version.id ? "page" : undefined}>
                    {words.version} {version.number} · {new Intl.DateTimeFormat("ru", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(version.created_at))}
                  </Link></li>)}</ul>
                {workspace.next_version_before ? <Link href={`${base}?template=${workspace.template.id}&before_version=${workspace.next_version_before}`} className={link}>{words.olderVersions}</Link> : null}
                {beforeVersion ? <Link href={`${base}?template=${workspace.template.id}`} className={link}>{words.currentVersion}</Link> : null}
              </details> : null}
              {writable && !upload && !edit ? <details className="border-t border-border pt-4">
                <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-fg-2">{management.archive}</summary>
                <UniversityFormDecision key={`archive:${workspace.template.id}`} catalogId={catalogId} templateId={workspace.template.id}
                  versionId={selected?.id ?? null} revision={workspace.template.revision} requestId={randomUUID()}
                  decision={{ operation: "archive" }} action={manageUniversityFormAction} />
              </details> : null}
            </> : <div className="space-y-2"><h2 className="text-xl font-bold text-fg">{templates.items.length ? words.choose : words.empty}</h2>
              <p className="max-w-xl text-sm leading-6 text-fg-2">{templates.items.length ? words.chooseExplanation : words.emptyExplanation}</p></div>}
        </div>
      </div>
    </div>
  </PartShell>;
}
