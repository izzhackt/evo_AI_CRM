"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ADMISSIONS_APPLICATION_FIELDS, ADMISSIONS_CASE_FIELDS, ADMISSIONS_DIRECTIONS, ADMISSIONS_STAGE_LABELS, ADMISSIONS_STAGES, ADMISSIONS_VISA_FIELDS, admissionsVisaFields, type AdmissionsField, type AdmissionsPlaybook, type AdmissionsStage, type AdmissionsWorkspace } from "@/lib/platform-admissions-playbook-contract";
import { AdmissionsRouteEditor, ADMISSIONS_BUTTON, ADMISSIONS_INPUT, admissionsValueLabel } from "./AdmissionsRouteEditor";
import { AdmissionsMessageTemplates } from "./AdmissionsMessageTemplates";
import { DIRECTION_LABELS } from "./admissions-view";

type Editor = { kind: "case"; section: string } | { kind: "application"; id: string; section: string } | { kind: "visa"; section: string } | { kind: "configure" } | { kind: "transition"; stage: AdmissionsStage; outcome: "active" | "arrived" | "cancelled" };
function compact(values: Record<string, string | undefined>): Record<string, string> { return Object.fromEntries(Object.entries(values).filter((entry): entry is [string, string] => typeof entry[1] === "string" && !!entry[1].trim())); }
function fieldValues(values: Record<string, string>, fields: readonly AdmissionsField[]): Record<string, string> { return Object.fromEntries(fields.flatMap((field) => values[field.key]?.trim() ? [[field.key, values[field.key].trim()]] : [])); }
const META = "Следующий шаг и маршрут";

export function AdmissionsRoutePanel({ workspace, playbooks, documents, studentName }: { workspace: AdmissionsWorkspace; playbooks: AdmissionsPlaybook[]; documents: readonly { id: string; name: string; applicationIds: readonly string[] }[]; studentName: string }) {
  const router = useRouter();
  const [editor, setEditor] = useState<Editor | null>(null);
  const [message, setMessage] = useState("");
  const [viewStage, setViewStage] = useState(workspace.case.stage);
  const current = workspace.case;
  const visaFields = admissionsVisaFields(current.direction);
  const index = ADMISSIONS_STAGES.indexOf(current.stage as AdmissionsStage);
  const selectedStage = workspace.playbook?.content.stages.find((item) => item.key === viewStage) ?? workspace.playbook?.content.stages[Math.max(index, 0)];
  // A fact from an earlier stage may have changed. The next transition checks
  // the whole completed route, so display those blockers before submission too.
  const requiredGates = workspace.gates.filter((gate) => ADMISSIONS_STAGES.indexOf(gate.stage) <= index);
  const currentGate = index < 0 ? null : { ready: requiredGates.length === index + 1 && requiredGates.every((gate) => gate.ready), blockers: requiredGates.flatMap((gate) => gate.blockers.map((blocker) => gate.stage === current.stage ? blocker : `${ADMISSIONS_STAGE_LABELS[gate.stage]}: ${blocker}`)) };
  const editable = current.state === "active";
  function saved(confirmed: boolean) { setEditor(null); setMessage(confirmed ? "Изменения сохранены. Загружаем актуальное дело…" : "Загружаем актуальные данные…"); router.refresh(); }
  function start(next: Editor) { if (!editor) { setEditor(next); setMessage(""); } }
  function editButton(next: Editor, label = "Изменить") {
    const postArrival = current.outcome === "arrived" && next.kind === "case" && [META, "После прибытия"].includes(next.section);
    const allowed = next.kind === "configure" ? editable : !!current.playbookVersionId && (editable || postArrival);
    return allowed ? <button type="button" className={ADMISSIONS_BUTTON} disabled={!!editor} onClick={() => start(next)}>{label}</button> : null;
  }
  const base = { caseId: current.id, expectedVersion: current.version };
  let editorView: React.ReactNode = null;
  if (editor?.kind === "configure") editorView = <AdmissionsRouteEditor title="Выбрать направление и маршрут" initialValues={{ direction: current.direction ?? "CN", nextAction: current.nextAction ?? "", dueOn: current.nextActionDueOn ?? "" }} fields={[]} onClose={() => setEditor(null)} onSaved={saved}
    makeCommand={(values, requestId) => ({ ...base, operation: "configure", requestId, direction: values.direction as typeof ADMISSIONS_DIRECTIONS[number], playbookVersionId: playbooks.find((item) => item.direction === values.direction)?.id ?? null, nextAction: values.nextAction, nextActionDueOn: values.dueOn })}
    extra={(values, change) => <>
      <label className="grid gap-2 text-sm text-fg-2">Направление<select className={ADMISSIONS_INPUT} value={values.direction} onChange={(event) => change("direction", event.target.value)}>{ADMISSIONS_DIRECTIONS.map((direction) => <option key={direction} value={direction}>{DIRECTION_LABELS[direction]}</option>)}</select></label>
      <p className="self-center text-sm text-fg-2">{playbooks.find((item) => item.direction === values.direction)?.title ?? "Подробный регламент этого направления ещё не добавлен."} Применение создаст задачи в существующем деле; версия маршрута будет зафиксирована.</p>
      <label className="grid gap-2 text-sm text-fg-2">Следующий шаг<input className={ADMISSIONS_INPUT} value={values.nextAction} maxLength={1000} onChange={(event) => change("nextAction", event.target.value)} /></label>
      <label className="grid gap-2 text-sm text-fg-2">Срок следующего шага<input type="date" className={ADMISSIONS_INPUT} value={values.dueOn} onChange={(event) => change("dueOn", event.target.value)} /></label>
    </>} />;
  if (editor?.kind === "case") editorView = <AdmissionsRouteEditor title={editor.section} initialValues={{ ...compact(current.facts), _primary: current.primaryApplicationId ?? "", _approval: current.routeApprovalStatus, _next: current.nextAction ?? "", _due: current.nextActionDueOn ?? "" }} fields={ADMISSIONS_CASE_FIELDS.filter((field) => field.section === editor.section)} documents={documents} onClose={() => setEditor(null)} onSaved={saved}
    makeCommand={(values, requestId) => ({ ...base, operation: "facts", requestId, facts: fieldValues(values, ADMISSIONS_CASE_FIELDS), primaryApplicationId: values._primary || null, routeApprovalStatus: values._approval as "draft" | "approved" | "rework", nextAction: values._next, nextActionDueOn: values._due })}
    extra={editor.section === META || editor.section === "Выбор программы" ? (values, change) => <>
      {editable ? <><label className="grid gap-2 text-sm text-fg-2">Основная заявка<select className={ADMISSIONS_INPUT} value={values._primary} onChange={(event) => change("_primary", event.target.value)}><option value="">Не выбрана</option>{workspace.applications.map((app) => <option key={app.id} value={app.id}>{app.institutionName} · {app.programName}</option>)}</select></label>
      <label className="grid gap-2 text-sm text-fg-2">Маршрут согласован<select className={ADMISSIONS_INPUT} value={values._approval} onChange={(event) => change("_approval", event.target.value)}><option value="draft">Черновик</option><option value="approved">Согласован с подтверждением</option><option value="rework">Требует уточнения</option></select></label></> : null}
      <label className="grid gap-2 text-sm text-fg-2">Следующий шаг<input className={ADMISSIONS_INPUT} maxLength={1000} value={values._next} onChange={(event) => change("_next", event.target.value)} /></label>
      <label className="grid gap-2 text-sm text-fg-2">Срок следующего шага<input type="date" className={ADMISSIONS_INPUT} value={values._due} onChange={(event) => change("_due", event.target.value)} /></label>
    </> : undefined} />;
  if (editor?.kind === "application") {
    const app = workspace.applications.find((item) => item.id === editor.id);
    if (app) editorView = <AdmissionsRouteEditor title={`${app.institutionName}: ${editor.section}`} initialValues={compact(app.details)} fields={ADMISSIONS_APPLICATION_FIELDS.filter((field) => field.section === editor.section)} documents={documents.filter((document) => document.applicationIds.includes(app.id))} onClose={() => setEditor(null)} onSaved={saved}
      makeCommand={(values, requestId) => ({ ...base, expectedVersion: app.version, operation: "application", applicationId: app.id, requestId, details: fieldValues(values, ADMISSIONS_APPLICATION_FIELDS) })} />;
  }
  if (editor?.kind === "visa" && workspace.visa) {
    const visa = workspace.visa;
    editorView = <AdmissionsRouteEditor title={editor.section} initialValues={compact(visa.details)} fields={visaFields.filter((field) => field.section === editor.section)} documents={documents} onClose={() => setEditor(null)} onSaved={saved}
      makeCommand={(values, requestId) => ({ ...base, expectedVersion: visa.version, operation: "visa", visaCaseId: visa.id, requestId, details: fieldValues(values, ADMISSIONS_VISA_FIELDS) })} />;
  }
  if (editor?.kind === "transition") editorView = <AdmissionsRouteEditor title={editor.outcome === "arrived" ? "Подтвердить завершение по прибытию" : editor.outcome === "cancelled" ? "Закрыть без успешного прибытия" : `Перейти: ${ADMISSIONS_STAGE_LABELS[editor.stage]}`} initialValues={{ reason: "" }} fields={[{ key: "reason", label: "Основание действия", kind: "text", section: "" }]} onClose={() => setEditor(null)} onSaved={saved}
    makeCommand={(values, requestId) => ({ ...base, requestId, operation: "transition", stage: editor.stage, outcome: editor.outcome, reason: values.reason })} />;

  return <div className="space-y-5" data-testid="admissions-route">
    <section className="rounded-card border border-border bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-medium text-accent">{current.direction ? DIRECTION_LABELS[current.direction] : "Направление не выбрано"}</p><h3 className="mt-1 text-xl font-semibold text-fg">{current.outcome === "arrived" ? "Прибытие подтверждено" : current.outcome === "cancelled" ? "Дело закрыто без прибытия" : ADMISSIONS_STAGE_LABELS[current.stage as AdmissionsStage] ?? "Настроить маршрут поступления"}</h3></div>
        {editButton({ kind: "case", section: META }, "Следующий шаг")}
      </div>
      <p className="mt-4 text-base leading-7 text-fg">{current.nextAction ?? "Назначьте понятный следующий шаг и срок."}{current.nextActionDueOn ? <time className="ml-2 text-fg-2" dateTime={current.nextActionDueOn}>до {current.nextActionDueOn.split("-").reverse().join(".")}</time> : null}</p>
      <nav aria-label="Работа по делу" className="mt-3 flex flex-wrap gap-3"><Link className={ADMISSIONS_BUTTON} href={`/v3/profile?case=${current.id}&tab=documents`}>Документы</Link><Link className={ADMISSIONS_BUTTON} href={`/v3/profile?case=${current.id}&tab=money`}>Оплата</Link><Link className={ADMISSIONS_BUTTON} href="/v3/calendar">Календарь задач</Link></nav>
      {!current.playbookVersionId && current.state === "active" ? <div className="mt-4 space-y-3"><p className="text-sm leading-6 text-fg-2">Выберите направление. Для Китая и Малайзии доступны подробные маршруты; старые дела не переводятся автоматически.</p>{editButton({ kind: "configure" }, "Выбрать маршрут")}</div> : null}
      {current.state === "pending" ? <p className="mt-3 text-sm text-fg-2">Дело ожидает активации. Сначала завершите существующую передачу и настройку доступа.</p> : null}
      {current.state === "closed" ? <div className="mt-3 space-y-3"><p className="text-sm leading-6 text-fg-2">Это закрытое дело. Неотмеченные формальности после прибытия не считаются выполненными. Для изменения маршрута сначала возобновите работу с указанием причины.</p>{current.playbookVersionId && index >= 0 ? <button type="button" className={ADMISSIONS_BUTTON} disabled={!!editor} onClick={() => start({ kind: "transition", stage: ADMISSIONS_STAGES[index], outcome: "active" })}>Возобновить работу по делу</button> : null}</div> : null}
    </section>
    {message ? <p role="status" className="text-sm text-fg-2">{message}</p> : null}
    {editorView}
    {workspace.playbook && selectedStage ? <section className="rounded-card border border-border bg-surface p-4 sm:p-5">
      <h3 className="text-base font-semibold text-fg">Маршрут · {workspace.playbook.version}</h3>
      <ol className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">{workspace.playbook.content.stages.map((stage, stageIndex) => <li key={stage.key}><button type="button" className={`flex min-h-11 w-full items-center gap-2 rounded-nav border px-3 py-2 text-left text-sm ${selectedStage.key === stage.key ? "border-accent bg-accent-weak text-accent" : "border-control-edge text-fg-2"}`} aria-pressed={selectedStage.key === stage.key} onClick={() => setViewStage(stage.key)}><span>{stageIndex + 1}.</span>{stage.title}{current.stage === stage.key ? <span className="sr-only"> — текущий этап дела</span> : null}</button></li>)}</ol>
      <div className="mt-5 border-t border-border pt-4"><h4 className="font-semibold text-fg">{selectedStage.title}</h4><p className="mt-2 text-sm leading-6 text-fg-2">{selectedStage.summary}</p><ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-fg-2">{selectedStage.checklist.map((item) => <li key={item}>{item}</li>)}</ul>
        {selectedStage.cautions.length ? <details className="mt-3"><summary className="min-h-11 cursor-pointer text-sm font-medium text-fg-2">Важно учесть</summary><ul className="list-disc space-y-2 pl-5 text-sm leading-6 text-fg-2">{selectedStage.cautions.map((item) => <li key={item}>{item}</li>)}</ul></details> : null}
      </div>
      {currentGate && editable ? <div className="mt-5 border-t border-border pt-4"><h4 className="font-medium text-fg">Готовность текущего этапа</h4>{currentGate.blockers.length ? <ul className="mt-2 list-disc space-y-2 pl-5 text-sm leading-6 text-danger">{currentGate.blockers.map((item) => <li key={item}>{item}</li>)}</ul> : <p className="mt-2 text-sm text-fg-2">Обязательные подтверждения записаны.</p>}
        <button type="button" className="mt-4 min-h-11 rounded-nav bg-accent px-5 text-sm font-semibold text-on-accent disabled:opacity-50" disabled={!!editor || !currentGate.ready || index < 0} onClick={() => start({ kind: "transition", stage: ADMISSIONS_STAGES[Math.min(index + 1, 6)], outcome: index === 6 ? "arrived" : "active" })}>{index === 6 ? "Завершить по подтверждённому прибытию" : "Завершить этап и перейти дальше"}</button>
      </div> : null}
    </section> : null}
    <details className="rounded-card border border-border bg-surface p-4 sm:p-5"><summary className="min-h-11 cursor-pointer font-semibold text-fg">Данные маршрута, жильё и поездка</summary><div className="mt-3 space-y-3">{[...new Set(ADMISSIONS_CASE_FIELDS.map((field) => field.section))].map((section) => <FactSection key={section} title={section} fields={ADMISSIONS_CASE_FIELDS.filter((field) => field.section === section)} values={current.facts} documents={documents} action={editButton({ kind: "case", section })} />)}</div></details>
    <section className="rounded-card border border-border bg-surface p-4 sm:p-5"><h3 className="font-semibold text-fg">Партнёр, подача и решение</h3><p className="mt-2 text-sm leading-6 text-fg-2">Маршрут следует основной заявке. Остальные заявки не закрываются автоматически.</p>
      {!workspace.applications.length ? <p className="mt-3 text-sm text-fg-2">Добавьте первую заявку в разделе «Заявки, статусы и визовое дело» ниже.</p> : workspace.applications.map((app) => <details key={app.id} className="mt-4 rounded-nav border border-border p-3" open={app.id === current.primaryApplicationId}><summary className="min-h-11 cursor-pointer font-medium text-fg">{app.institutionName} · {app.programName}{app.id === current.primaryApplicationId ? " — основная" : ""}</summary><div className="mt-2 space-y-3">{[...new Set(ADMISSIONS_APPLICATION_FIELDS.map((field) => field.section))].map((section) => <FactSection key={section} title={section} fields={ADMISSIONS_APPLICATION_FIELDS.filter((field) => field.section === section)} values={app.details} documents={documents} action={editButton({ kind: "application", id: app.id, section })} />)}</div></details>)}
    </section>
    <details className="rounded-card border border-border bg-surface p-4 sm:p-5"><summary className="min-h-11 cursor-pointer font-semibold text-fg">{current.direction === "MY" ? "Готовность к въезду · EMGS, eVAL и MDAC" : "Подтверждения визы"}</summary>
      {current.direction === "MY" ? <p className="mt-2 text-sm leading-6 text-fg-2">Здесь подтверждается готовность к въезду. Статус «Одобрено» визового дела не означает, что Student Pass уже оформлен: его подтверждение вносится отдельно в «После прибытия».</p> : null}
      {workspace.visa ? <div className="mt-3 space-y-3">{[...new Set(visaFields.map((field) => field.section))].map((section) => <FactSection key={section} title={section} fields={visaFields.filter((field) => field.section === section)} values={workspace.visa!.details} documents={documents} action={editButton({ kind: "visa", section })} />)}</div> : <p className="mt-3 text-sm text-fg-2">Создайте визовое дело в существующих контролах ниже.</p>}
    </details>
    {workspace.playbook ? <><AdmissionsMessageTemplates playbook={workspace.playbook} stage={current.stage} studentName={studentName} /><details className="rounded-card border border-border bg-surface p-4 sm:p-5"><summary className="min-h-11 cursor-pointer text-sm font-medium text-fg-2">Источники и ограничения маршрута</summary><ul className="mt-2 list-disc space-y-2 pl-5 text-sm leading-6 text-fg-2">{workspace.playbook.content.limitations.map((item) => <li key={item}>{item}</li>)}</ul>{workspace.playbook.content.sources.map((source) => <p key={source.id} className="mt-3 text-xs leading-5 text-fg-3">{source.url ? <a href={source.url} target="_blank" rel="noreferrer" className="underline">{source.title}</a> : source.title} · проверено {source.reviewedOn}. {source.scope}</p>)}</details></> : null}
    {current.playbookVersionId && editable ? <details className="rounded-card border border-border bg-surface p-4 sm:p-5"><summary className="min-h-11 cursor-pointer text-sm font-medium text-fg-2">Вернуться на этап или прекратить работу</summary><p className="mt-2 text-sm text-fg-2">Потребуется основание. Подтверждения и история сохранятся; закрытие без прибытия не считается успехом.</p><div className="mt-3 flex flex-wrap gap-2">{ADMISSIONS_STAGES.slice(0, Math.max(index, 0)).map((stage) => <button key={stage} type="button" className={ADMISSIONS_BUTTON} disabled={!!editor} onClick={() => start({ kind: "transition", stage, outcome: "active" })}>{ADMISSIONS_STAGE_LABELS[stage]}</button>)}<button type="button" className={ADMISSIONS_BUTTON} disabled={!!editor} onClick={() => start({ kind: "transition", stage: ADMISSIONS_STAGES[Math.max(index, 0)], outcome: "cancelled" })}>Закрыть без прибытия</button></div></details> : null}
    {workspace.events.length ? <details className="rounded-card border border-border bg-surface p-4 sm:p-5"><summary className="min-h-11 cursor-pointer text-sm font-medium text-fg-2">История маршрута</summary><ol className="mt-3 space-y-3">{workspace.events.map((event) => <li key={event.id} className="text-sm leading-6 text-fg-2"><time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleDateString("ru-RU", { timeZone: "Asia/Bishkek" })}</time> · {ADMISSIONS_STAGE_LABELS[event.stage as AdmissionsStage] ?? (event.outcome === "arrived" ? "Прибытие" : "Изменение маршрута")} — {event.reason}</li>)}</ol></details> : null}
  </div>;
}

function FactSection({ title, fields, values, action, documents }: { title: string; fields: readonly AdmissionsField[]; values: Record<string, string | undefined>; action: React.ReactNode; documents: readonly { id: string; name: string }[] }) {
  const shown = fields.filter((field) => values[field.key]);
  return <details className="rounded-nav border border-border p-3"><summary className="min-h-11 cursor-pointer text-sm font-medium text-fg">{title}<span className="ml-2 font-normal text-fg-3">{shown.length ? `${shown.length} заполнено` : "не заполнено"}</span></summary>
    {shown.length ? <dl className="my-3 grid gap-3 sm:grid-cols-2">{shown.map((field) => <div key={field.key} className="min-w-0"><dt className="text-xs text-fg-3">{field.label}</dt><dd className="mt-1 break-words whitespace-pre-wrap text-sm leading-6 text-fg">{field.key === "documentSlotIds" || field.key === "documentExceptionSlotIds" ? values[field.key]!.split(",").map((id) => documents.find((doc) => doc.id === id)?.name ?? "Недоступный пункт документа").join(", ") : admissionsValueLabel(values[field.key]!)}</dd></div>)}</dl> : <p className="my-3 text-sm text-fg-2">Подтверждений пока нет. Это не означает, что пункт выполнен или не требуется.</p>}{action}
  </details>;
}
