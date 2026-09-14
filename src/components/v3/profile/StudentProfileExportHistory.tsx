"use client";

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import type { StoredDocumentExportReceipt, DocumentExportWorkspaceV2, UniversityFormExportCommand, UniversityFormExportWorkspace } from "@/lib/document-export-artifact-contract";
import {
  createDocumentExport, createUniversityFormExport, reconcileDocumentExport, downloadDocumentExport, readDocumentExportHistory,
  documentExportWorkspaceMatches, updateDocumentExportHistory, type DocumentExportCommand, type DocumentExportOutcome,
} from "@/lib/document-export-client";
import { studentProfileFiles as words, studentProfileFileMessage, studentProfileFileState } from "@/lib/v3/wording";
import { StaffDisclosure } from "../settings/StaffDisclosure";
import { UniversityFormExportPanel } from "./UniversityFormExportPanel";
import type { ProfileApplication } from "./types";

const BUTTON = "min-h-11 rounded-ctl border border-control-edge px-3 py-2 text-sm font-semibold text-fg hover:bg-bg disabled:cursor-not-allowed disabled:text-fg-3";
const PRIMARY = "min-h-11 rounded-ctl border border-accent bg-accent px-3 py-2 text-sm font-semibold text-white hover:brightness-95 disabled:cursor-not-allowed disabled:border-border disabled:bg-bg disabled:text-fg-3 disabled:hover:brightness-100";
const DATE = new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bishkek" });
const unfinished = (artifact: StoredDocumentExportReceipt) => artifact.state !== "ready" && artifact.state !== "failed";
type ExportCommand = DocumentExportCommand | UniversityFormExportCommand;
type RetainedCommand = Readonly<{ studentCaseId: string; command: ExportCommand }>;
const NO_APPLICATIONS: readonly Pick<ProfileApplication, "id" | "institution" | "program">[] = [];
type Props = Readonly<{
  studentCaseId: string; profile: { id: string; revision: number }; canExport: boolean; ready: boolean;
  draftBlocker: string | null; finalBlocker: string | null; busy: boolean;
  commandInFlightRef: RefObject<boolean>; onBusyChange(value: boolean): void; onRefreshProfile(): void;
  applications?: readonly Pick<ProfileApplication, "id" | "institution" | "program">[];
  children?: ReactNode;
}>;

/** The same compact list renders cold history and newly received artifact receipts. */
export function StudentProfileExportList({ artifacts, busy, uncertainReconciles, onDownload, onReconcile }: Readonly<{
  artifacts: readonly StoredDocumentExportReceipt[]; busy: boolean; uncertainReconciles: readonly string[];
  onDownload(artifact: StoredDocumentExportReceipt): void; onReconcile(artifact: StoredDocumentExportReceipt): void;
}>) {
  const rows = (items: readonly StoredDocumentExportReceipt[]) => <ul className="divide-y divide-border">
    {items.map(artifact => <li key={artifact.id} className="min-w-0 space-y-2 py-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="text-sm font-semibold">{artifact.kind === "university_form"
          ? `${words.universityForm} · ${artifact.mime_type === "application/pdf" ? "PDF" : "Word"} · ${artifact.mode === "final" ? words.filled : words.draft}`
          : artifact.mode === "final" ? words.final : words.draft}</p>
        <time className="text-sm text-fg-2" dateTime={artifact.created_at}>{DATE.format(new Date(artifact.created_at))}</time>
      </div>
      <p className="text-sm leading-6 text-fg-2">{artifact.kind === "university_form"
        ? artifact.historical ? words.formHistorical : words.formCurrent
        : artifact.historical ? words.historical : words.current} · {studentProfileFileState(artifact.state)}</p>
      {artifact.failure_code ? <p className="text-sm leading-6 text-fg-2">{studentProfileFileMessage(artifact.failure_code)}</p> : null}
      {artifact.state === "ready" ? artifact.can_download
        ? <button type="button" className={BUTTON} disabled={busy} onClick={() => onDownload(artifact)}>{words.download}</button>
        : <p className="text-sm text-fg-3">{words.noDownload}</p>
        : unfinished(artifact) ? <button type="button" className={BUTTON} disabled={busy} onClick={() => onReconcile(artifact)}>
          {uncertainReconciles.includes(artifact.id) ? words.retryReconcile : words.reconcile}
        </button> : null}
    </li>)}
  </ul>;
  return <div aria-label={words.history}>
    {artifacts.length ? rows(artifacts.slice(0, 3)) : <p className="text-sm text-fg-2">{words.empty}</p>}
    {artifacts.length > 3 ? <StaffDisclosure label={words.older} buttonClassName="font-semibold">{rows(artifacts.slice(3))}</StaffDisclosure> : null}
  </div>;
}

export function StudentProfileExportHistory(props: Props) {
  const { studentCaseId, profile, canExport, commandInFlightRef, onBusyChange } = props;
  const [workspace, setWorkspace] = useState<DocumentExportWorkspaceV2 | null>(null);
  const [loading, setLoading] = useState(canExport);
  const [readFailed, setReadFailed] = useState(false);
  const [status, setStatus] = useState("idle");
  const [readVersion, setReadVersion] = useState(0);
  const [unresolvedCommand, setUnresolvedCommand] = useState<RetainedCommand | null>(null);
  const [uncertainReconciles, setUncertainReconciles] = useState<readonly string[]>([]);
  const reconcileRequests = useRef(new Map<string, string>());
  const readEpoch = useRef(0);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const epoch = ++readEpoch.current;
    async function load() {
      setLoading(canExport);
      if (!canExport) { setWorkspace(null); return; }
      const result = await readDocumentExportHistory(studentCaseId, controller.signal);
      if (controller.signal.aborted || epoch !== readEpoch.current) return;
      if (result.workspace) setWorkspace(result.workspace);
      setReadFailed(!result.workspace); setLoading(false);
      if (!result.workspace) setStatus(result.status);
    }
    void load();
    return () => controller.abort();
  }, [studentCaseId, profile.id, profile.revision, canExport, readVersion]);

  const matches = documentExportWorkspaceMatches(workspace, studentCaseId, profile);
  const unresolvedHistory = workspace?.artifacts.some(unfinished) ?? false;
  const needsRefresh = ["source_changed", "request_conflict", "access_changed", "invalid_request"].includes(status);
  const creationBlocked = props.busy || loading || readFailed || !matches || Boolean(unresolvedCommand) || needsRefresh;
  const draftBlocker = props.draftBlocker === "profile_not_ready" ? "draft_invalid" : props.draftBlocker;
  // A form uses its own required mappings, not the generic profile's required fields.
  const formBlocker = [props.draftBlocker, props.finalBlocker].find(value => value && value !== "profile_not_ready") ?? null;
  const retryBlocked = !unresolvedCommand || unresolvedCommand.studentCaseId !== studentCaseId
    || Boolean("kind" in unresolvedCommand.command ? formBlocker : props.draftBlocker);
  // A mapped form may not use the invalid generic-profile field. Its explicit
  // result must remain audible; unsaved/access/stale blockers still take priority.
  const blockerHint = draftBlocker === "draft_invalid" && status !== "idle" ? null : draftBlocker;
  const hint = !canExport ? "unavailable_access" : props.busy ? ["creating", "reconciling", "downloading"].includes(status) ? status : "saving" : unresolvedCommand ? "unknown"
    : blockerHint ?? (loading ? "loading" : readFailed ? status : !matches && workspace ? "workspace_changed" : status !== "idle" ? status : unresolvedHistory ? "unresolved" : "idle");

  function begin(nextStatus: string): boolean {
    if (commandInFlightRef.current || props.busy || !canExport) return false;
    commandInFlightRef.current = true; onBusyChange(true); setStatus(nextStatus);
    // A read started before this command must not replace its newer receipt.
    readEpoch.current++; setLoading(false);
    return true;
  }
  function end() { commandInFlightRef.current = false; if (mounted.current) onBusyChange(false); }
  function receive(result: DocumentExportOutcome) {
    if (result.artifact) {
      setWorkspace(current => current ? updateDocumentExportHistory(current, result.artifact) : current);
      setStatus(result.artifact.state === "ready" ? "ready" : result.artifact.state === "failed" ? result.artifact.failure_code! : "pending");
    } else setStatus(result.uncertain ? "unknown" : result.status);
  }
  async function execute(command: ExportCommand) {
    if (!begin("creating")) return;
    const epoch = readEpoch.current;
    setUnresolvedCommand({ studentCaseId, command });
    try {
      const result = "kind" in command ? await createUniversityFormExport(studentCaseId, command) : await createDocumentExport(studentCaseId, command);
      if (!mounted.current) return;
      if (epoch === readEpoch.current) receive(result);
      else setStatus(result.uncertain ? "unknown" : "idle");
      if (!result.uncertain) setUnresolvedCommand(null);
    } finally { end(); }
  }
  async function generate(mode: "draft" | "final") {
    if (props.draftBlocker || creationBlocked || (mode === "final" && props.finalBlocker) || !workspace?.workspace_revision) return;
    let requestId: string;
    try { requestId = crypto.randomUUID(); }
    catch { setStatus("export_unavailable"); return; }
    await execute({ mode, expected_workspace_revision: workspace.workspace_revision, request_id: requestId });
  }
  async function generateForm(mode: "draft" | "final", selected: UniversityFormExportWorkspace) {
    if (creationBlocked || formBlocker || !selected.can_export || !selected.selection || !selected.workspace_revision
      || selected.student_case_id !== studentCaseId || selected.profile?.id !== profile.id || selected.profile.revision !== profile.revision
      || !(props.applications ?? NO_APPLICATIONS).some(item => item.id === selected.application_id)) return;
    let requestId: string;
    try { requestId = crypto.randomUUID(); }
    catch { setStatus("export_unavailable"); return; }
    await execute({ kind: "university_form", application_id: selected.application_id, mapping_id: selected.selection.mapping_id,
      mode, expected_workspace_revision: selected.workspace_revision, request_id: requestId });
  }
  async function retry() {
    if (retryBlocked || !unresolvedCommand) return;
    await execute(unresolvedCommand.command);
  }
  async function reconcile(artifact: StoredDocumentExportReceipt) {
    if (!unfinished(artifact)) return;
    let requestId: string;
    try { requestId = reconcileRequests.current.get(artifact.id) ?? crypto.randomUUID(); }
    catch { setStatus("export_unavailable"); return; }
    if (!begin("reconciling")) return;
    reconcileRequests.current.set(artifact.id, requestId);
    try {
      const result = await reconcileDocumentExport(studentCaseId, artifact.id, requestId);
      if (!mounted.current) return;
      receive(result);
      if (!result.uncertain) reconcileRequests.current.delete(artifact.id);
      setUncertainReconciles([...reconcileRequests.current.keys()]);
    } finally { end(); }
  }
  async function download(artifact: StoredDocumentExportReceipt) {
    if (!begin("downloading")) return;
    try {
      const result = await downloadDocumentExport(studentCaseId, artifact);
      if (mounted.current) setStatus(result);
    } finally { end(); }
  }
  function refresh() { setStatus("idle"); setReadVersion(current => current + 1); }

  return <div className="space-y-3 border-y border-border py-4" aria-label={words.title}>
    <h4 className="text-sm font-semibold">{words.title}</h4>
    <p className="text-sm leading-6 text-fg-2">{words.explanation}</p>
    <p className={`text-sm font-semibold ${props.ready ? "text-ok" : "text-fg"}`}>{props.ready ? words.ready : words.notReady}</p>
    <div className="flex flex-wrap gap-2">
      <button type="button" className={PRIMARY} disabled={creationBlocked || Boolean(props.finalBlocker)} onClick={() => void generate("final")}>{words.createFinal}</button>
      <button type="button" className={BUTTON} disabled={creationBlocked || Boolean(props.draftBlocker)} onClick={() => void generate("draft")}>{words.createDraft}</button>
    </div>
    <p className="text-sm leading-6 text-fg-2">{words.draftExplanation}</p>
    <p role="status" aria-live="polite" className="text-sm leading-6 text-fg-2">{studentProfileFileMessage(hint)}</p>
    {unresolvedCommand ? <button type="button" className={BUTTON} disabled={props.busy || retryBlocked || !canExport}
      onClick={() => void retry()}>{words.retry}</button> : null}
    {canExport ? <div className="flex flex-wrap gap-2">
      <button type="button" className={BUTTON} disabled={props.busy || loading} onClick={refresh}>{words.refresh}</button>
      {props.draftBlocker === "awaiting_snapshot" || needsRefresh || hint === "workspace_changed"
        ? <button type="button" className={BUTTON} disabled={props.busy || loading} onClick={() => { props.onRefreshProfile(); refresh(); }}>{words.refreshProfile}</button> : null}
    </div> : null}
    {props.children}
    <UniversityFormExportPanel key={`${studentCaseId}:${profile.id}:${profile.revision}:${canExport}`} studentCaseId={studentCaseId} profile={profile}
      applications={props.applications ?? NO_APPLICATIONS} canExport={canExport} busy={props.busy} creationBlocked={creationBlocked}
      unresolved={Boolean(unresolvedCommand)} blocker={formBlocker} readVersion={readVersion} onGenerate={generateForm}
      onRefreshProfile={() => { props.onRefreshProfile(); refresh(); }} />
    {workspace ? <StudentProfileExportList artifacts={workspace.artifacts} busy={props.busy || !canExport}
      uncertainReconciles={uncertainReconciles} onDownload={artifact => void download(artifact)} onReconcile={artifact => void reconcile(artifact)} /> : null}
  </div>;
}
