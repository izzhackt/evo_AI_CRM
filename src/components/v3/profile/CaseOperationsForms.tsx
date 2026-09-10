"use client";
import { startTransition, useActionState, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { answerCaseHelpAction, createCaseHelpAction, preparePartnerPacketAction } from "@/lib/platform-admissions-support-actions";
import type { CaseHelpRequest, CaseOperationResult, PacketFile, PartnerPacket } from "@/lib/platform-admissions-support-contract";

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
export function PreparePartnerPacketForm({ caseId, files, applications }: { caseId: string; files: readonly PacketFile[]; applications: readonly { id: string; name: string }[] }) {
  const command = useCaseCommand(preparePartnerPacketAction); const [applicationId, setApplicationId] = useState(""); const [selected, setSelected] = useState<string[]>([]);
  if (!applications.length || !files.length) return <p className="text-sm leading-6 text-fg-2">Для подготовки нужны заявление и принятые файлы с завершённой проверкой. Добавьте их в существующих разделах дела.</p>;
  return <form className="space-y-3" onSubmit={event => { event.preventDefault(); command.submit({ caseId, applicationId, versionIds: selected, requestId: crypto.randomUUID() }); }}>
    <fieldset disabled={command.blocked} className="space-y-3"><label className="grid gap-1.5 text-sm text-fg-2">Заявление<select className={INPUT} required value={applicationId} onChange={event => setApplicationId(event.target.value)}><option value="">Выберите заявление</option>{applications.map(app => <option key={app.id} value={app.id}>{app.name}</option>)}</select></label>
      <div><p className="text-sm font-medium text-fg">Принятые версии · выбрано {selected.length} из 50 максимум</p><div className="mt-2 max-h-80 overflow-y-auto rounded-ctl border border-border">{files.map(file => <label key={file.versionId} className="flex min-h-11 items-center gap-3 border-b border-border px-3 py-2 last:border-0"><input type="checkbox" checked={selected.includes(file.versionId)} onChange={event => setSelected(previous => event.target.checked ? [...previous, file.versionId] : previous.filter(id => id !== file.versionId))} /><span className="min-w-0 break-words text-sm text-fg">{file.name} <span className="text-fg-3">· версия {file.versionNo}</span></span></label>)}</div></div>
    </fieldset><Result command={command} />
    {command.result?.ok ? <button type="button" className={SECONDARY} onClick={() => { setSelected([]); command.reset(); }}>Подготовить ещё один пакет</button>
      : <button className={BUTTON} disabled={command.pending || !selected.length || selected.length > 50 || !applicationId || Boolean(command.result && !command.result.ok && ["stale", "request_conflict"].includes(command.result.code))}>{command.pending ? "Фиксируем состав…" : command.result && !command.result.ok && command.result.code === "unavailable" ? "Проверить сохранение" : "Зафиксировать пакет"}</button>}
  </form>;
}
export function DownloadPacketManifest({ packet }: { packet: PartnerPacket }) {
  return <button type="button" className={SECONDARY} onClick={() => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(packet, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = `evo-packet-${packet.id}.json`; link.click(); URL.revokeObjectURL(url);
  }}>Скачать состав пакета</button>;
}
