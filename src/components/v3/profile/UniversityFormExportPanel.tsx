"use client";

import { useEffect, useState } from "react";
import type { ApplicationPublishedFormsWorkspace, UniversityFormExportWorkspace } from "@/lib/document-export-artifact-contract";
import { readPublishedFormsForApplication, readUniversityFormExportWorkspace } from "@/lib/document-export-client";
import { universityFormExport as words, studentProfileFiles, studentProfileFileMessage } from "@/lib/v3/wording";
import type { ProfileApplication } from "./types";

const BUTTON = "min-h-11 rounded-ctl border border-control-edge px-3 py-2 text-sm font-semibold text-fg hover:bg-bg disabled:cursor-not-allowed disabled:text-fg-3";
const PRIMARY = "min-h-11 rounded-ctl border border-accent bg-accent px-3 py-2 text-sm font-semibold text-white hover:brightness-95 disabled:cursor-not-allowed disabled:border-border disabled:bg-bg disabled:text-fg-3 disabled:hover:brightness-100";
const SELECT = "min-h-11 w-full min-w-0 rounded-ctl border border-control-edge bg-surface px-3 py-2 text-sm text-fg disabled:cursor-not-allowed disabled:text-fg-3";
type ReadResult<T> = Readonly<{ key: string; status: string; workspace: T | null }>;
type Props = Readonly<{
  studentCaseId: string; profile: Readonly<{ id: string; revision: number }>;
  applications: readonly Pick<ProfileApplication, "id" | "institution" | "program">[];
  canExport: boolean; busy: boolean; creationBlocked: boolean; unresolved: boolean; blocker: string | null; readVersion: number;
  onGenerate(mode: "draft" | "final", workspace: UniversityFormExportWorkspace): void;
  onRefreshProfile(): void;
}>;

/** Selection reads are disposable; the parent owns the one retained export command and history. */
export function UniversityFormExportPanel(props: Props) {
  const { studentCaseId, profile, canExport, applications, readVersion } = props;
  const [applicationId, setApplicationId] = useState("");
  const [formId, setFormId] = useState("");
  const [afterId, setAfterId] = useState<string | undefined>();
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [selectionVersion, setSelectionVersion] = useState(0);
  const [catalogRead, setCatalogRead] = useState<ReadResult<ApplicationPublishedFormsWorkspace> | null>(null);
  const [formRead, setFormRead] = useState<ReadResult<UniversityFormExportWorkspace> | null>(null);
  const applicationExists = applications.some(item => item.id === applicationId);
  const catalogKey = JSON.stringify([studentCaseId, profile.id, profile.revision, applicationId, afterId, readVersion, refreshVersion, canExport]);
  const catalogResult = canExport && applicationExists && catalogRead?.key === catalogKey ? catalogRead : null;
  const catalog = catalogResult?.workspace ?? null;
  const forms = catalog?.forms;
  const selectedForm = forms?.items.find(item => item.id === formId);
  const mappingId = selectedForm?.publication.mapping_id ?? "";
  const formKey = JSON.stringify([catalogKey, formId, mappingId, selectedForm?.publication.review_id, selectionVersion]);
  const formResult = formRead?.key === formKey ? formRead : null;
  const workspace = formResult?.workspace ?? null;
  const catalogLoading = canExport && applicationExists && !catalogResult;
  const formLoading = canExport && Boolean(selectedForm) && !formResult;

  useEffect(() => {
    if (!canExport || !applicationExists) return;
    const controller = new AbortController();
    async function load() {
      const result = await readPublishedFormsForApplication(studentCaseId, applicationId, afterId, controller.signal);
      if (!controller.signal.aborted) setCatalogRead({ ...result, key: catalogKey });
    }
    void load();
    return () => controller.abort();
  }, [studentCaseId, applicationId, applicationExists, afterId, canExport, catalogKey]);

  useEffect(() => {
    if (!canExport || !applicationExists || !mappingId) return;
    const controller = new AbortController();
    async function load() {
      const result = await readUniversityFormExportWorkspace(studentCaseId, applicationId, mappingId, controller.signal);
      if (!controller.signal.aborted) setFormRead({ ...result, key: formKey });
    }
    void load();
    return () => controller.abort();
  }, [studentCaseId, applicationId, applicationExists, mappingId, canExport, formKey]);

  const selection = workspace?.selection;
  const publicationMatches = Boolean(selectedForm && selection && catalog
    && workspace?.student_case_id === studentCaseId && workspace.application_id === applicationId
    && workspace.catalog_institution_id === catalog.catalog_institution_id
    && selection.application_id === applicationId && selection.catalog_institution_id === catalog.catalog_institution_id
    && selection.template_id === selectedForm.id && selection.template_version_id === selectedForm.publication.template_version_id
    && selection.mapping_id === mappingId && selection.mapping_sha256 === selectedForm.publication.mapping_sha256
    && selection.review_id === selectedForm.publication.review_id);
  const profileMatches = workspace?.profile?.id === profile.id && workspace.profile.revision === profile.revision;
  const canGenerate = canExport && applicationExists && publicationMatches && profileMatches && workspace?.can_export && Boolean(workspace.workspace_revision)
    && !props.creationBlocked && !props.blocker && !catalogLoading && !formLoading;
  const controlsBlocked = props.busy || props.unresolved || !canExport;
  const failure = catalogResult && !catalog ? studentProfileFileMessage(catalogResult.status) ?? words.loadFailed
    : formResult && !workspace ? studentProfileFileMessage(formResult.status) ?? words.loadFailed : null;
  const selectionMessage = workspace ? workspace.unavailable_reason === "profile_missing" ? words.profileMissing
    : !publicationMatches ? words.mappingChanged : !profileMatches ? words.profileChanged : words.ready : null;
  const message = !canExport ? studentProfileFileMessage("unavailable_access") : props.unresolved ? words.uncertain
    : props.blocker ? studentProfileFileMessage(props.blocker) : catalogLoading ? words.loading : formLoading ? words.checking
    : failure ?? selectionMessage;

  function refresh() { setFormId(""); setRefreshVersion(value => value + 1); }
  function page(cursor?: string) { setFormId(""); setAfterId(cursor); setRefreshVersion(value => value + 1); }
  function generate(mode: "draft" | "final") {
    if (canGenerate && workspace) props.onGenerate(mode, workspace);
  }

  return <section aria-label={words.title} aria-busy={props.busy || catalogLoading || formLoading} className="space-y-3 border-t border-border pt-4">
    <h4 className="text-sm font-semibold">{words.title}</h4>
    <p className="text-sm leading-6 text-fg-2">{words.explanation}</p>
    {applications.length ? <label className="block space-y-1 text-sm font-semibold">
      <span>{words.application}</span>
      <select className={SELECT} value={applicationExists ? applicationId : ""} disabled={controlsBlocked}
        onChange={event => { setApplicationId(event.target.value); setFormId(""); setAfterId(undefined); setRefreshVersion(value => value + 1); }}>
        <option value="">{words.chooseApplication}</option>
        {applications.map(application => <option key={application.id} value={application.id}>{application.institution} · {application.program}</option>)}
      </select>
    </label> : <p className="text-sm leading-6 text-fg-2">{words.noApplications}</p>}
    {canExport && applicationExists ? <>
      {catalog && !forms ? <p className="text-sm leading-6 text-fg-2">{words.noCatalog}</p> : null}
      {forms?.items.length ? <label className="block space-y-1 text-sm font-semibold">
        <span>{words.form}</span>
        <select className={SELECT} value={selectedForm ? formId : ""} disabled={controlsBlocked || catalogLoading}
          onChange={event => { setFormId(event.target.value); setSelectionVersion(value => value + 1); }}>
          <option value="">{words.chooseForm}</option>
          {forms.items.map(form => <option key={form.id} value={form.id}>{form.title}</option>)}
        </select>
      </label> : forms ? <p className="text-sm leading-6 text-fg-2">{afterId ? words.noMoreForms : words.noForms}</p> : null}
      <div className="flex flex-wrap gap-2">
        {afterId ? <button type="button" className={BUTTON} disabled={controlsBlocked || catalogLoading} onClick={() => page()}>{words.first}</button> : null}
        {forms?.next_after_id ? <button type="button" className={BUTTON} disabled={controlsBlocked || catalogLoading}
          onClick={() => page(forms.next_after_id!)}>{words.next}</button> : null}
        <button type="button" className={BUTTON} disabled={controlsBlocked || catalogLoading || formLoading} onClick={refresh}>{failure ? words.retry : words.refresh}</button>
      </div>
    </> : null}
    {message ? <p role="status" aria-live="polite" className="text-sm leading-6 text-fg-2">{message}</p> : null}
    {workspace && !profileMatches ? <button type="button" className={BUTTON} disabled={controlsBlocked}
      onClick={props.onRefreshProfile}>{studentProfileFiles.refreshProfile}</button> : null}
    {selectedForm ? <>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={PRIMARY} disabled={!canGenerate} onClick={() => generate("final")}>{words.createFinal}</button>
        <button type="button" className={BUTTON} disabled={!canGenerate} onClick={() => generate("draft")}>{words.createDraft}</button>
      </div>
      <p className="text-sm leading-6 text-fg-2">{words.draft}</p>
    </> : null}
  </section>;
}
