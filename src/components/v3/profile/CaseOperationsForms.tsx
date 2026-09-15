"use client";
import { startTransition, useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { answerCaseHelpAction, createCaseHelpAction, preparePartnerPacketAction } from "@/lib/platform-admissions-support-actions";
import type { CaseHelpRequest, CaseOperationResult, PacketGeneratedExport, PacketWorkspace, PartnerPacket } from "@/lib/platform-admissions-support-contract";
import type { DocumentExportWorkspaceV2, DocumentPackageExportCommand, StoredDocumentExportReceipt } from "@/lib/document-export-artifact-contract";
import { createDocumentPackageExport, downloadDocumentExport, readDocumentExportHistory, reconcileDocumentExport, updateDocumentExportHistory, type DocumentExportOutcome } from "@/lib/document-export-client";
import { partnerPacketExport as words, studentProfileFileMessage } from "@/lib/v3/wording";
import { StudentProfileExportList } from "./StudentProfileExportHistory";

const INPUT = "min-h-11 w-full rounded-ctl border border-control-edge bg-surface px-3 py-2 text-sm text-fg focus-visible:outline-2 focus-visible:outline-focus-ring";
const BUTTON = "inline-flex min-h-11 items-center justify-center rounded-ctl bg-accent px-4 py-2 text-sm font-semibold text-on-accent disabled:opacity-50";
const SECONDARY = "inline-flex min-h-11 items-center rounded-ctl border border-control-edge px-3 text-sm font-medium text-fg";

function useCaseCommand(action: (input: unknown) => Promise<CaseOperationResult>, onSaved?: () => void) {
  const router = useRouter(); const frozen = useRef<unknown>(null);
  const [refreshing, refresh] = useTransition();
  const [result, dispatch, pending] = useActionState(async (_previous: CaseOperationResult | null, input: unknown) => {
    const payload = frozen.current ?? input; frozen.current = payload;
    let response: CaseOperationResult;
    try { response = await action(payload); }
    catch { response = { ok: false, code: "unavailable", message: "Результат не подтверждён. Повторите тот же запрос." }; }
    if (response.ok) { frozen.current = null; onSaved?.(); refresh(() => router.refresh()); }
    else if (response.code !== "unavailable") frozen.current = null;
    return response;
  }, null);
  const [dismissed, setDismissed] = useState(false);
  const visible = dismissed ? null : result;
  const blocked = pending || refreshing || (visible !== null && (visible.ok || visible.code === "unavailable" || visible.code === "stale" || visible.code === "request_conflict"));
  return { result: visible, pending: pending || refreshing, blocked,
    submit(input: unknown) { setDismissed(false); startTransition(() => dispatch(input)); },
    reset() { if (visible && !visible.ok && visible.code === "unavailable") return; setDismissed(true); refresh(() => router.refresh()); },
  };
}
function Result({ command }: { command: ReturnType<typeof useCaseCommand> }) {
  const result = command.result;
  if (!result) return null;
  return <div className="space-y-2"><p role={result.ok ? "status" : "alert"} className={`text-sm ${result.ok ? "text-fg-2" : "text-danger"}`}>
    {result.ok ? "Сохранено." : result.message}</p>
    {!result.ok && ["stale", "request_conflict"].includes(result.code) ? <button className={SECONDARY} type="button" disabled={command.pending} onClick={command.reset}>Сверить обновлённые данные</button> : null}
  </div>;
}

export function CreateCaseHelpForm({ onSaved }: { onSaved?: () => void }) {
  const command = useCaseCommand(createCaseHelpAction, onSaved); const [subject, setSubject] = useState(""); const [body, setBody] = useState("");
  return <details className="rounded-card border border-border bg-surface p-4 sm:p-5"><summary className="min-h-11 cursor-pointer font-semibold text-fg">Нужна помощь</summary>
    <p className="my-3 text-sm leading-6 text-fg-2">Вопрос увидит команда, которая ведёт ваше дело. Это обращение внутри EVO, не сообщение в WhatsApp.</p>
    <form className="space-y-3" onSubmit={event => { event.preventDefault(); command.submit({ subject, body, requestId: crypto.randomUUID() }); }}>
      <fieldset disabled={command.blocked} className="space-y-3"><label className="grid gap-1.5 text-sm text-fg-2">Тема<input className={INPUT} required maxLength={160} value={subject} onChange={event => setSubject(event.target.value)} /></label>
      <label className="grid gap-1.5 text-sm text-fg-2">Что нужно уточнить<textarea className={INPUT} required rows={4} maxLength={4000} value={body} onChange={event => setBody(event.target.value)} /></label></fieldset>
      <Result command={command} />
      {command.result?.ok ? <button type="button" className={SECONDARY} onClick={() => { setSubject(""); setBody(""); command.reset(); }}>Новое обращение</button>
        : <button className={BUTTON} disabled={command.pending || Boolean(command.result && !command.result.ok && ["stale", "request_conflict"].includes(command.result.code))}>{command.pending ? "Сохраняем…" : command.result && !command.result.ok && command.result.code === "unavailable" ? "Проверить сохранение" : "Передать вопрос команде"}</button>}
    </form>
  </details>;
}
export function AnswerCaseHelpForm({ caseId, request, onSaved }: { caseId: string; request: CaseHelpRequest; onSaved?: () => void }) {
  const command = useCaseCommand(answerCaseHelpAction, onSaved); const [answer, setAnswer] = useState(request.answer ?? "");
  return <form className="mt-4 space-y-3" onSubmit={event => { event.preventDefault(); command.submit({ caseId, id: request.id, answer, version: request.version, requestId: crypto.randomUUID() }); }}>
    <label className="grid gap-1.5 text-sm text-fg-2">Ответ студенту<textarea className={INPUT} required rows={3} maxLength={4000} readOnly={command.blocked} value={answer} onChange={event => setAnswer(event.target.value)} /></label>
    <Result command={command} />
    {command.result?.ok ? <button type="button" className={SECONDARY} onClick={command.reset}>Дополнить ответ</button> : <button className={BUTTON} disabled={command.pending || Boolean(command.result && !command.result.ok && ["stale", "request_conflict"].includes(command.result.code))}>{command.pending ? "Сохраняем…" : command.result && !command.result.ok && command.result.code === "unavailable" ? "Проверить сохранение" : "Сохранить ответ в кабинете"}</button>}
  </form>;
}
function generatedLabel(file: PacketGeneratedExport) {
  return `${file.kind === "university_form" ? words.form : words.profile} · ${file.mimeType === "application/pdf" ? "PDF" : "Word"} · ${file.mode === "final" ? words.final : words.draft} · ${new Date(file.createdAt).toLocaleString("ru-RU", { timeZone: "Asia/Bishkek" })}`;
}

export function formatPacketFileSize(bytes: number): string {
  if (bytes > 0 && bytes < 1024) return words.lessThanKb;
  const megabytes = bytes >= 1024 * 1024;
  return `${(bytes / (megabytes ? 1024 * 1024 : 1024)).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} ${megabytes ? words.mb : words.kb}`;
}

/** UI feedback only; the server validates every selected item again without omission. */
export function partnerPacketSelection(workspace: PacketWorkspace, applicationId: string, versionIds: readonly string[], exportIds: readonly string[]) {
  const originals = versionIds.map(id => workspace.files.find(file => file.versionId === id));
  const generated = exportIds.map(id => workspace.generatedExports.find(file => file.id === id));
  const count = versionIds.length + exportIds.length;
  const bytes = [...originals, ...generated].reduce((sum, file) => sum + (file?.sizeBytes ?? 0), 0);
  const missing = originals.some(file => !file) || generated.some(file => !file);
  const error = missing ? words.missing : count > 50 ? words.tooMany
    : generated.some(file => file?.applicationId && file.applicationId !== applicationId) ? words.wrongApplication
    : bytes > workspace.maxArchiveBytes ? words.tooLarge : count === 0 ? words.emptySelection : null;
  return { count, bytes, missing, error };
}

export function partnerPacketZipBlocker(packet: PartnerPacket, mode: "draft" | "final", maxBytes: number): string | null {
  if (!packet.revision) return words.legacy;
  if (packet.files.length + packet.generatedExports.length > 50) return words.tooMany;
  if ([...packet.files, ...packet.generatedExports].reduce((sum, file) => sum + file.sizeBytes, 0) > maxBytes) return words.tooLarge;
  if (mode === "final" && packet.generatedExports.some(file => file.mode === "draft")) return words.draftInFinal;
  return null;
}

type PacketApplications = readonly { id: string; name: string }[];
export function PreparePartnerPacketForm({ caseId, workspace, applications, active, disabled, action }: {
  caseId: string; workspace: PacketWorkspace; applications: PacketApplications; active: boolean; disabled: boolean;
  action: (input: unknown) => Promise<CaseOperationResult>;
}) {
  const command = useCaseCommand(action);
  const [applicationId, setApplicationId] = useState("");
  const [versionIds, setVersionIds] = useState<string[]>([]);
  const [exportIds, setExportIds] = useState<string[]>([]);
  const selection = partnerPacketSelection(workspace, applicationId, versionIds, exportIds);
  const uncertain = Boolean(command.result && !command.result.ok && command.result.code === "unavailable");
  const invalid = !active || !applications.some(app => app.id === applicationId) || Boolean(selection.error);
  const blocked = disabled || command.pending || (!uncertain && (invalid || command.blocked));
  const generated = workspace.generatedExports.filter(file => exportIds.includes(file.id) || !file.applicationId || file.applicationId === applicationId);
  return <form className="space-y-3" onSubmit={event => {
    event.preventDefault(); if (blocked) return;
    // useCaseCommand retains the original payload on uncertainty, even after a refresh.
    command.submit({ caseId, applicationId, versionIds, exportIds, expectedRevision: workspace.workspaceRevision, requestId: crypto.randomUUID() });
  }}>
    {!active ? <p className="text-sm text-fg-3">{words.inactive}</p> : null}
    {!applications.length || (!workspace.files.length && !workspace.generatedExports.length) ? <p className="text-sm leading-6 text-fg-2">{words.prerequisites}</p> : null}
    <fieldset disabled={!active || command.blocked || disabled} className="space-y-3">
      <label className="grid gap-1.5 text-sm text-fg-2">{words.application}<select className={INPUT} required value={applicationId} onChange={event => setApplicationId(event.target.value)}><option value="">{words.chooseApplication}</option>{applications.map(app => <option key={app.id} value={app.id}>{app.name}</option>)}</select></label>
      <p className="text-sm font-medium text-fg" aria-live="polite">{words.selected} {selection.count} {words.of50} · {formatPacketFileSize(selection.bytes)}</p>
      <div><p className="text-sm font-medium text-fg">{words.originals}</p><div className="mt-2 max-h-80 overflow-y-auto rounded-ctl border border-border">{workspace.files.map(file => <label key={file.versionId} className="flex min-h-11 items-center gap-3 border-b border-border px-3 py-2 last:border-0"><input type="checkbox" checked={versionIds.includes(file.versionId)} disabled={selection.count >= 50 && !versionIds.includes(file.versionId)} onChange={event => setVersionIds(previous => event.target.checked ? [...previous, file.versionId] : previous.filter(id => id !== file.versionId))} /><span className="min-w-0 break-words text-sm text-fg">{file.name} <span className="text-fg-3">· {words.version} {file.versionNo} · {formatPacketFileSize(file.sizeBytes)}</span></span></label>)}</div></div>
      <div><p className="text-sm font-medium text-fg">{words.generated}</p>{!generated.length ? <p className="mt-2 text-sm text-fg-3">{words.noGenerated}</p> : <div className="mt-2 max-h-80 overflow-y-auto rounded-ctl border border-border">{generated.map(file => <label key={file.id} className="flex min-h-11 items-center gap-3 border-b border-border px-3 py-2 last:border-0"><input type="checkbox" checked={exportIds.includes(file.id)} disabled={selection.count >= 50 && !exportIds.includes(file.id)} onChange={event => setExportIds(previous => event.target.checked ? [...previous, file.id] : previous.filter(id => id !== file.id))} /><span className="min-w-0 break-words text-sm text-fg">{generatedLabel(file)} · {formatPacketFileSize(file.sizeBytes)}</span></label>)}</div>}</div>
      {selection.error && selection.count > 0 ? <p role="alert" className="text-sm text-danger">{selection.error}</p> : null}
      {selection.missing ? <button type="button" className={SECONDARY} onClick={() => {
        setVersionIds(ids => ids.filter(id => workspace.files.some(file => file.versionId === id)));
        setExportIds(ids => ids.filter(id => workspace.generatedExports.some(file => file.id === id)));
      }}>{words.removeMissing}</button> : null}
    </fieldset><Result command={command} />
    {command.result?.ok ? <button type="button" className={SECONDARY} disabled={disabled || command.pending} onClick={() => { setVersionIds([]); setExportIds([]); command.reset(); }}>{words.another}</button>
      : <button className={BUTTON} disabled={blocked}>{command.pending ? words.preparing : uncertain ? words.retryPrepare : words.prepare}</button>}
  </form>;
}

export function PartnerPacketWorkspace({ caseId, active, applications, workspace }: {
  caseId: string; active: boolean; applications: PacketApplications; workspace: PacketWorkspace;
}) {
  const router = useRouter();
  const [history, setHistory] = useState<DocumentExportWorkspaceV2 | null>(null);
  const [loading, setLoading] = useState(true);
  const [readFailed, setReadFailed] = useState(false);
  const [readVersion, setReadVersion] = useState(0);
  const [status, setStatus] = useState("idle");
  const [busy, setBusy] = useState(false);
  const [unresolved, setUnresolved] = useState<{ caseId: string; command: DocumentPackageExportCommand } | null>(null);
  const [prepareUncertain, setPrepareUncertain] = useState(false);
  const [uncertainReconciles, setUncertainReconciles] = useState<readonly string[]>([]);
  const reconcileRequests = useRef(new Map<string, string>());
  const inFlight = useRef(false); const mounted = useRef(false); const readEpoch = useRef(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController(); const epoch = ++readEpoch.current;
    async function load() {
      setLoading(true); setReadFailed(false);
      const result = await readDocumentExportHistory(caseId, controller.signal);
      if (controller.signal.aborted || epoch !== readEpoch.current || !mounted.current) return;
      const valid = result.workspace?.student_case_id === caseId;
      setHistory(valid ? result.workspace : null); setReadFailed(!valid); setLoading(false);
    }
    void load(); return () => controller.abort();
  }, [caseId, readVersion]);
  const artifacts = history?.student_case_id === caseId ? history.artifacts.filter(item => item.kind === "package") : [];
  const pending = artifacts.some(item => item.state !== "ready" && item.state !== "failed");
  const creationBlocked = busy || loading || readFailed || !history || Boolean(unresolved) || prepareUncertain || uncertainReconciles.length > 0 || pending;
  function begin(nextStatus: string, invalidateRead = true) {
    if (inFlight.current) return false;
    inFlight.current = true;
    if (invalidateRead) { readEpoch.current++; setLoading(false); }
    setBusy(true); setStatus(nextStatus); return true;
  }
  function end() { inFlight.current = false; if (mounted.current) setBusy(false); }
  function receive(result: DocumentExportOutcome) {
    if (result.artifact) {
      setHistory(previous => previous ? updateDocumentExportHistory(previous, result.artifact) : previous);
      setStatus(result.artifact.state === "ready" ? "ready" : result.artifact.state === "failed" ? result.artifact.failure_code! : "pending");
    } else setStatus(result.uncertain ? "unknown" : result.status);
  }
  async function prepare(input: unknown): Promise<CaseOperationResult> {
    if (!begin("idle", false)) return { ok: false, code: "unavailable", message: studentProfileFileMessage("unknown")! };
    try {
      const result = await preparePartnerPacketAction(input).catch((): CaseOperationResult => ({ ok: false, code: "unavailable", message: studentProfileFileMessage("unknown")! }));
      if (mounted.current) setPrepareUncertain(!result.ok && result.code === "unavailable");
      return result;
    } finally { end(); }
  }
  async function execute(command: DocumentPackageExportCommand) {
    if (!begin("creating")) return;
    const epoch = readEpoch.current; setUnresolved({ caseId, command });
    try {
      const result = await createDocumentPackageExport(caseId, command);
      if (!mounted.current) return;
      if (epoch === readEpoch.current) receive(result);
      if (!result.uncertain) setUnresolved(null);
    } finally { end(); }
  }
  function generate(packet: PartnerPacket, mode: "draft" | "final") {
    if (!active || creationBlocked || !packet.revision || partnerPacketZipBlocker(packet, mode, workspace.maxArchiveBytes)) return;
    void execute({ kind: "package", packet_id: packet.id, mode, expected_workspace_revision: packet.revision, request_id: crypto.randomUUID() });
  }
  async function reconcile(artifact: StoredDocumentExportReceipt) {
    if (unresolved || prepareUncertain || !begin("reconciling")) return;
    const requestId = reconcileRequests.current.get(artifact.id) ?? crypto.randomUUID();
    reconcileRequests.current.set(artifact.id, requestId);
    try {
      const result = await reconcileDocumentExport(caseId, artifact.id, requestId);
      if (!mounted.current) return;
      receive(result);
      if (result.uncertain) setUncertainReconciles(previous => [...new Set([...previous, artifact.id])]);
      else { reconcileRequests.current.delete(artifact.id); setUncertainReconciles(previous => previous.filter(id => id !== artifact.id)); }
    } finally { end(); }
  }
  async function download(artifact: StoredDocumentExportReceipt) {
    if (unresolved || prepareUncertain || !begin("downloading", false)) return;
    try { const result = await downloadDocumentExport(caseId, artifact); if (mounted.current) setStatus(result); }
    finally { end(); }
  }
  const message = words.errors[status] ?? studentProfileFileMessage(status);
  return <div className="space-y-5" aria-busy={busy}>
    <p className="text-sm leading-6 text-fg-2">{words.cap} {words.sizeHint}</p>
    <PreparePartnerPacketForm caseId={caseId} workspace={workspace} applications={applications} active={active}
      disabled={busy || Boolean(unresolved) || uncertainReconciles.length > 0 || pending} action={prepare} />
    <div><h4 className="font-medium text-fg">{words.recent}</h4>{!workspace.packets.length ? <p className="mt-2 text-sm text-fg-3">{words.noPackets}</p> : <ul className="mt-3 space-y-3">{workspace.packets.map(packet => {
      const draftBlocker = partnerPacketZipBlocker(packet, "draft", workspace.maxArchiveBytes);
      const finalBlocker = partnerPacketZipBlocker(packet, "final", workspace.maxArchiveBytes);
      return <li key={packet.id} className="rounded-ctl border border-border p-3"><details><summary className="min-h-11 cursor-pointer text-sm font-medium text-fg">{packet.applicationName} · {new Date(packet.createdAt).toLocaleString("ru-RU", { timeZone: "Asia/Bishkek" })}</summary>
        <p className="my-2 text-xs text-fg-3">{words.preparedBy}: {packet.createdBy}. ID: {packet.id}</p><DownloadPacketManifest packet={packet} />
        <ul className="mt-3 divide-y divide-border">{packet.files.map(file => <li key={file.versionId} className="py-3 text-sm"><p className="break-words text-fg">{file.name} · {words.version} {file.versionNo}</p><a className="inline-flex min-h-11 items-center font-medium text-accent-text underline" href={`/api/v2/document-versions/${file.versionId}/download`}>{words.originalDownload}</a></li>)}
          {packet.generatedExports.map(file => <li key={file.id} className="break-words py-3 text-sm text-fg">{generatedLabel(file)}</li>)}</ul>
        <div className="my-3 flex flex-wrap gap-2"><button className={BUTTON} type="button" disabled={!active || creationBlocked || Boolean(draftBlocker)} onClick={() => generate(packet, "draft")}>{words.createDraft}</button><button className={SECONDARY} type="button" disabled={!active || creationBlocked || Boolean(finalBlocker)} onClick={() => generate(packet, "final")}>{words.createFinal}</button></div>
        {draftBlocker || finalBlocker ? <p className="text-sm leading-6 text-fg-2">{draftBlocker ?? finalBlocker}</p> : null}
        <p className="text-xs leading-5 text-fg-3">{words.privacy}</p>
      </details></li>;
    })}</ul>}</div>
    <div className="space-y-3"><h4 className="font-medium text-fg">{words.history}</h4>
      {loading ? <p role="status" className="text-sm text-fg-2">{words.loading}</p> : readFailed ? <p role="alert" className="text-sm text-danger">{words.historyFailed}</p> : null}
      {message ? <p role="status" className="text-sm leading-6 text-fg-2">{message}</p> : null}
      {unresolved ? <button type="button" className={BUTTON} disabled={busy || unresolved.caseId !== caseId} onClick={() => { if (unresolved.caseId === caseId) void execute(unresolved.command); }}>{words.retryCreate}</button> : null}
      {pending ? <p className="text-sm leading-6 text-fg-2">{words.pending}</p> : null}
      <button type="button" className={SECONDARY} disabled={busy || Boolean(unresolved) || prepareUncertain || uncertainReconciles.length > 0} onClick={() => { setReadVersion(version => version + 1); router.refresh(); }}>{words.refresh}</button>
      {!loading && !readFailed ? artifacts.length ? <StudentProfileExportList artifacts={artifacts} busy={busy || Boolean(unresolved) || prepareUncertain} uncertainReconciles={uncertainReconciles} onDownload={artifact => { void download(artifact); }} onReconcile={artifact => { void reconcile(artifact); }} /> : <p className="text-sm text-fg-3">{words.emptyHistory}</p> : null}
    </div>
  </div>;
}
export function DownloadPacketManifest({ packet }: { packet: PartnerPacket }) {
  return <button type="button" className={SECONDARY} onClick={() => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(packet, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = `evo-packet-${packet.id}.json`; link.click(); URL.revokeObjectURL(url);
  }}>{words.manifest}</button>;
}
