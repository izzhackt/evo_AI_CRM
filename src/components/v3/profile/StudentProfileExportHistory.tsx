"use client";

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import type { DocumentExportReceipt, DocumentExportWorkspace } from "@/lib/document-export-artifact-contract";
import {
  createDocumentExport, reconcileDocumentExport, downloadDocumentExport, readDocumentExportWorkspace,
  documentExportWorkspaceMatches, updateDocumentExportHistory, type DocumentExportCommand, type DocumentExportOutcome,
} from "@/lib/document-export-client";
import { studentProfileFiles as words, studentProfileFileMessage, studentProfileFileState } from "@/lib/v3/wording";
import { StaffDisclosure } from "../settings/StaffDisclosure";

const BUTTON = "min-h-11 rounded-ctl border border-control-edge px-3 py-2 text-sm font-semibold text-fg hover:bg-bg disabled:cursor-not-allowed disabled:text-fg-3";
const PRIMARY = "min-h-11 rounded-ctl border border-accent bg-accent px-3 py-2 text-sm font-semibold text-white hover:brightness-95 disabled:cursor-not-allowed disabled:border-border disabled:bg-bg disabled:text-fg-3 disabled:hover:brightness-100";
const DATE = new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bishkek" });
const unfinished = (artifact: DocumentExportReceipt) => artifact.state !== "ready" && artifact.state !== "failed";
type Props = Readonly<{
  studentCaseId: string; profile: { id: string; revision: number }; canExport: boolean; ready: boolean;
  draftBlocker: string | null; finalBlocker: string | null; busy: boolean;
  commandInFlightRef: RefObject<boolean>; onBusyChange(value: boolean): void; onRefreshProfile(): void;
  children?: ReactNode;
}>;

/** The same compact list renders cold history and newly received artifact receipts. */
export function StudentProfileExportList({ artifacts, busy, uncertainReconciles, onDownload, onReconcile }: Readonly<{
  artifacts: readonly DocumentExportReceipt[]; busy: boolean; uncertainReconciles: readonly string[];
  onDownload(artifact: DocumentExportReceipt): void; onReconcile(artifact: DocumentExportReceipt): void;
}>) {
  const rows = (items: readonly DocumentExportReceipt[]) => <ul className="divide-y divide-border">
    {items.map(artifact => <li key={artifact.id} className="min-w-0 space-y-2 py-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="text-sm font-semibold">{artifact.mode === "final" ? words.final : words.draft}</p>
        <time className="text-sm text-fg-2" dateTime={artifact.created_at}>{DATE.format(new Date(artifact.created_at))}</time>
      </div>
      <p className="text-sm leading-6 text-fg-2">{artifact.historical ? words.historical : words.current} · {studentProfileFileState(artifact.state)}</p>
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
  const [workspace, setWorkspace] = useState<DocumentExportWorkspace | null>(null);
  const [loading, setLoading] = useState(canExport);
  const [readFailed, setReadFailed] = useState(false);
  const [status, setStatus] = useState("idle");
  const [readVersion, setReadVersion] = useState(0);
  const [unresolvedCommand, setUnresolvedCommand] = useState<DocumentExportCommand | null>(null);
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
      const result = await readDocumentExportWorkspace(studentCaseId, controller.signal);
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
  const hint = !canExport ? "unavailable_access" : props.busy ? ["creating", "reconciling", "downloading"].includes(status) ? status : "saving" : unresolvedCommand ? "unknown"
    : draftBlocker ?? (loading ? "loading" : readFailed ? status : !matches && workspace ? "workspace_changed" : status !== "idle" ? status : unresolvedHistory ? "unresolved" : "idle");

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
  async function generate(mode: "draft" | "final", retry?: DocumentExportCommand) {
    if (props.draftBlocker || (!retry && (creationBlocked || (mode === "final" && props.finalBlocker) || !workspace?.workspace_revision))) return;
    let command: DocumentExportCommand;
    try { command = retry ?? { mode, expected_workspace_revision: workspace!.workspace_revision!, request_id: crypto.randomUUID() }; }
    catch { setStatus("export_unavailable"); return; }
    if (!begin("creating")) return;
    setUnresolvedCommand(command);
    try {
      const result = await createDocumentExport(studentCaseId, command);
      if (!mounted.current) return;
      receive(result);
      if (!result.uncertain) setUnresolvedCommand(null);
    } finally { end(); }
  }
  async function reconcile(artifact: DocumentExportReceipt) {
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
  async function download(artifact: DocumentExportReceipt) {
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
    {unresolvedCommand ? <button type="button" className={BUTTON} disabled={props.busy || Boolean(props.draftBlocker) || !canExport}
      onClick={() => void generate(unresolvedCommand.mode, unresolvedCommand)}>{words.retry}</button> : null}
    {canExport ? <div className="flex flex-wrap gap-2">
      <button type="button" className={BUTTON} disabled={props.busy || loading} onClick={refresh}>{words.refresh}</button>
      {props.draftBlocker === "awaiting_snapshot" || needsRefresh || hint === "workspace_changed"
        ? <button type="button" className={BUTTON} disabled={props.busy || loading} onClick={() => { props.onRefreshProfile(); refresh(); }}>{words.refreshProfile}</button> : null}
    </div> : null}
    {props.children}
    {workspace ? <StudentProfileExportList artifacts={workspace.artifacts} busy={props.busy || !canExport}
      uncertainReconciles={uncertainReconciles} onDownload={artifact => void download(artifact)} onReconcile={artifact => void reconcile(artifact)} /> : null}
  </div>;
}
