"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { btnCls, btnGhostCls, inputCls } from "@/components/ui";
import type { ApplicationRequirementsEditorContext as Context, ApplicationRequirementsEditorSource as Source,
  ApplicationRequirementsEditorCandidate as Candidate, RequirementsEditorScope } from "@/lib/portal/application-requirements-editor";
import { readStaffRequirementsEditorAction, saveStaffRequirementsEditorAction } from "@/lib/v3/staff-requirements-editor-actions";
import { EDITOR_PENDING_EVENT, editorPendingKey, readEditorPending, sendEditorPending } from "@/lib/portal/application-requirements-editor-pending";
import { buildRequirementsPayload, contextChanges, draftFromPayload, draftProblems, editorMaterial, initialRequirementsDraft,
  newRequirementsDraftItem, rebaseRequirementsDraft, requirementChanges, sourceCanUseItem,
  requirementsRebaseConflicts, requirementsDraftMatchesPayload,
  type RequirementsDraft, type RequirementsDraftItem, type DraftProblem, type RequirementsRebaseChoices } from "./requirements-editor-draft";

const areaCls = `${inputCls} min-h-24 py-2`;
const reasons: Record<string, string> = {
  invalid: "Проверьте поля списка. Сохранённый запрос оставлен для проверки результата.",
  forbidden: "Доступ к этому делу изменился. Сохранённый запрос не удалён.",
  request_conflict: "Этот запрос уже использован с другими данными. Сохранённый запрос оставлен для проверки.",
  stale_context: "Документы или требования изменились. Загрузите актуальные сведения и сравните их с черновиком.",
  case_ineligible: "Дело должно быть активным, а портал — открыт. Черновик сохранён на экране.",
  application_ineligible: "Заявка больше не находится на этапе подготовки. Черновик сохранён на экране.",
  legacy_configuration_conflict: "Список конфликтует с прежними настройками документов заявки. Проверьте их отдельно, затем обновите сведения.",
  editor_limit: "Список превышает допустимый размер. Ничего не усечено; проверьте количество пунктов.",
  unavailable: "Ответ не получен. Список мог сохраниться. Повторите тот же запрос для получения результата.",
  storage_unavailable: "Браузер не смог сохранить запрос перед отправкой. Разрешите хранение данных для этого сайта и попробуйте снова.",
  busy: "Список сохраняется в другой вкладке. Дождитесь результата.",
  pending_conflict: "В другой вкладке уже есть запрос с неизвестным результатом. Сначала проверьте его.",
  no_pending: "Сохранённый запрос уже обработан. Обновите сведения о списке.",
};
const blockedReasons: Record<string, string> = {
  permission_required: "Для изменения списка нужно право на управление документами этого дела.",
  case_inactive: "Изменение списка доступно только в активном деле.",
  portal_inactive: "Для изменения списка сначала откройте портал студента.",
  application_not_preparation: "Изменение списка доступно на этапе подготовки заявки.",
};
function subscribe(callback: () => void) {
  window.addEventListener("storage", callback); window.addEventListener(EDITOR_PENDING_EVENT, callback);
  return () => { window.removeEventListener("storage", callback); window.removeEventListener(EDITOR_PENDING_EVENT, callback); };
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block min-w-0 text-sm text-fg-2"><span className="mb-1 block font-medium">{label}</span>{children}</label>;
}
function fileSummary(candidate: Candidate): string {
  const review = candidate.reviewDecision === "approved" ? "версия файла принята" : candidate.reviewDecision === "correction_required" ? "нужны исправления" : candidate.reviewDecision === "rejected" ? "версия отклонена" : "решения по файлу пока нет";
  return candidate.currentVersionId ? `${candidate.filename} · версия ${candidate.currentVersionNo} · ${review}${candidate.technicalAvailability === "unavailable" ? " · файл технически недоступен" : ""}` : "Файл ещё не загружен";
}
function sourceLabel(source: Source): string {
  return source.kind === "prior" ? "Предыдущий список" : source.kind === "country" ? "Чек-лист страны" : source.kind === "application" ? "Настройки заявки" : "Документ заявки";
}
function ItemFields({ item, index, count, context, used, disabled, update, move, remove, id }: {
  item: RequirementsDraftItem; index: number; count: number; context: Context; used: Set<string>; disabled: boolean;
  update: (item: RequirementsDraftItem) => void; move: (offset: number) => void; remove: () => void; id: string;
}) {
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<"existing" | "new" | "">(item.material?.kind ?? "");
  const material = item.material;
  const selected = material?.kind === "existing" ? context.candidates.find(candidate => candidate.documentSlotId === material.documentSlotId) : null;
  const candidates = context.candidates.filter(candidate => candidate.documentSlotId === selected?.documentSlotId || `${candidate.label} ${candidate.groupLabel} ${candidate.filename ?? ""}`.toLocaleLowerCase("ru").includes(search.toLocaleLowerCase("ru")));
  function definition(patch: Partial<RequirementsDraftItem>) {
    update({ ...item, ...patch, provenance: item.provenance.kind === "typed_starter" ? { kind: "staff_entry", sourceKey: null, basis: "" } : item.provenance });
  }
  return <section id={id} tabIndex={-1} className="min-w-0 border-b border-border py-5">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h5 className="t-item min-w-0 break-words text-fg">{index + 1}. {item.label || "Новое требование"}</h5>
      <div className="flex flex-wrap gap-1"><button type="button" className={btnGhostCls} disabled={disabled || index === 0} aria-label={`Поднять пункт ${index + 1}`} onClick={() => move(-1)}>Выше</button><button type="button" className={btnGhostCls} disabled={disabled || index === count - 1} aria-label={`Опустить пункт ${index + 1}`} onClick={() => move(1)}>Ниже</button><button type="button" className={btnGhostCls} disabled={disabled} onClick={remove}>Убрать пункт</button></div>
    </div>
    <div className="grid min-w-0 gap-3 md:grid-cols-2">
      <Field label="Название требования"><input className={inputCls} value={item.label} onChange={event => definition({ label: event.target.value })} /></Field>
      <Field label="Группа"><input className={inputCls} value={item.groupLabel} onChange={event => definition({ groupLabel: event.target.value })} /></Field>
      <label className="flex min-h-11 items-center gap-2 text-sm text-fg md:col-span-2"><input type="checkbox" className="size-5 accent-accent" checked={item.required} onChange={event => definition({ required: event.target.checked })} />Обязательный документ</label>
      <div className="md:col-span-2"><Field label="Что нужно подготовить"><textarea className={areaCls} value={item.instructions} onChange={event => definition({ instructions: event.target.value })} /></Field></div>
    </div>
    <fieldset className="mt-4 min-w-0"><legend className="mb-2 text-sm font-semibold text-fg">Документ для этого требования</legend>
      <div className="flex flex-wrap gap-x-5 gap-y-2">{([ ["existing", "Использовать документ дела"], ["new", "Добавить отдельный документ"] ] as const).map(([value, label]) => <label key={value} className="flex min-h-11 items-center gap-2 text-sm text-fg"><input type="radio" className="size-5 accent-accent" name={`${id}-material`} checked={(item.material?.kind ?? kind) === value} onChange={() => {
        setKind(value); setSearch(""); update({ ...item, material: value === "new" ? { kind: "new", label: "", groupLabel: "" } : null, provenance: { kind: "staff_entry", sourceKey: null, basis: "" } });
      }} />{label}</label>)}</div>
      {(item.material?.kind ?? kind) === "existing" ? <div className="mt-2 grid gap-3">
        <Field label="Найти документ дела"><input className={inputCls} type="search" value={search} onChange={event => setSearch(event.target.value)} /></Field>
        <Field label={`Документ дела (${candidates.length})`}><select className={inputCls} value={material?.kind === "existing" ? material.documentSlotId : ""} onChange={event => update({ ...item, material: editorMaterial(context, event.target.value), provenance: { kind: "staff_entry", sourceKey: null, basis: "" } })}>
          <option value="">Выберите документ</option>{candidates.map(candidate => <option key={candidate.documentSlotId} value={candidate.documentSlotId} disabled={used.has(candidate.documentSlotId) && candidate.documentSlotId !== selected?.documentSlotId}>{candidate.label} · {candidate.groupLabel}{candidate.filename ? ` · ${candidate.filename}` : " · без файла"}{used.has(candidate.documentSlotId) && candidate.documentSlotId !== selected?.documentSlotId ? " · уже выбран" : ""}</option>)}
        </select></Field>
        {selected ? <div className="break-words text-sm leading-6 text-fg-2"><p>{fileSummary(selected)}</p><p>Используется в заявках: {selected.links.filter(link => link.targetKind === "university_application").length}. В визовых делах: {selected.links.filter(link => link.targetKind === "visa_case").length}.</p>{selected.reviewReason ? <p>{selected.reviewReason}</p> : null}</div> : <p className="text-sm text-fg-3">Материал нужно выбрать явно. Совпадение названия не подтверждает, что файл подходит.</p>}
      </div> : material?.kind === "new" ? <div className="mt-2 grid gap-3 md:grid-cols-2">
        <Field label="Название нового документа в деле"><input className={inputCls} value={material.label} onChange={event => update({ ...item, material: { ...material, label: event.target.value } })} /></Field>
        <Field label="Группа нового документа"><input className={inputCls} value={material.groupLabel} onChange={event => update({ ...item, material: { ...material, groupLabel: event.target.value } })} /></Field>
        <p className="text-sm text-fg-3 md:col-span-2">После сохранения в деле появится пустой документ. Файл нужно будет загрузить отдельно.</p>
      </div> : null}
      <div className="mt-3"><Field label="Почему документ подходит"><textarea className={areaCls} value={item.provenance.basis} onChange={event => update({ ...item, provenance: { ...item.provenance, basis: event.target.value } })} /></Field></div>
    </fieldset>
    <details className="mt-3"><summary className="cursor-pointer py-2 text-sm font-semibold text-fg">Срок документа{item.deadline ? `: ${item.deadline.date || "не заполнен"}` : " (не указан)"}</summary>
      <label className="flex min-h-11 items-center gap-2 text-sm text-fg"><input type="checkbox" className="size-5 accent-accent" checked={item.deadline !== null} onChange={event => definition({ deadline: event.target.checked ? { date: "", time: null, timezone: null, sourceUrl: null, verifiedOn: "" } : null })} />Указать отдельный срок для документа</label>
      {item.deadline ? <div className="grid gap-3 md:grid-cols-2">{([ ["date", "Дата", "date"], ["time", "Время (если известно)", "time"], ["timezone", "Часовой пояс, например Asia/Bishkek", "text"], ["sourceUrl", "Официальный источник срока (https://)", "url"], ["verifiedOn", "Когда срок проверили", "date"] ] as const).map(([key, label, type]) => <Field key={key} label={label}><input className={inputCls} type={type} value={item.deadline?.[key] ?? ""} onChange={event => definition({ deadline: { ...item.deadline!, [key]: event.target.value || (key === "date" || key === "verifiedOn" ? "" : null) } })} /></Field>)}</div> : null}
    </details>
  </section>;
}

export function StaffRequirementsEditor({ scope, onClose, onSaved }: { scope: RequirementsEditorScope; onClose: () => void; onSaved: () => void }) {
  const prefix = useId();
  const targetId = (target: string) => `${prefix}-${target}`;
  const pendingKey = editorPendingKey(scope);
  const raw = useSyncExternalStore(subscribe, () => { try { return localStorage.getItem(pendingKey); } catch { return "blocked"; } }, () => null);
  const retained = raw === null ? { intent: null, blocked: false } : readEditorPending(scope);
  const [base, setBase] = useState<Context | null>(null);
  const [fresh, setFresh] = useState<Context | null>(null);
  const [rebaseChoices, setRebaseChoices] = useState<RequirementsRebaseChoices>({});
  const [draft, setDraft] = useState<RequirementsDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [readDenied, setReadDenied] = useState(false);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [problems, setProblems] = useState<DraftProblem[]>([]);
  const [sourcesQuery, setSourcesQuery] = useState("");
  const [onlyUnresolved, setOnlyUnresolved] = useState(false);
  const [sourcePage, setSourcePage] = useState(0);
  const [reviewed, setReviewed] = useState(false);
  const mounted = useRef(true);
  const epoch = useRef(0);
  const busy = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const owner = { organizationId: scope.organizationId, membershipId: scope.membershipId };
  const target = { studentCaseId: scope.studentCaseId, applicationId: scope.applicationId };
  const dirty = !!retained.intent || !!(base && draft && JSON.stringify(draft) !== JSON.stringify(initialRequirementsDraft(base)));
  const locked = sending || !!retained.intent || retained.blocked || !!fresh || needsRefresh || readDenied || !base?.canSave;

  useEffect(() => {
    mounted.current = true;
    let active = true;
    const current = ++epoch.current;
    void readStaffRequirementsEditorAction({ organizationId: scope.organizationId, membershipId: scope.membershipId }, { studentCaseId: scope.studentCaseId, applicationId: scope.applicationId }).then(result => {
      if (!active || !mounted.current || current !== epoch.current) return;
      if (result.status === "ready") {
        const pending = readEditorPending({ organizationId: scope.organizationId, membershipId: scope.membershipId, studentCaseId: scope.studentCaseId, applicationId: scope.applicationId });
        setBase(result.value); setDraft(pending.intent ? draftFromPayload(pending.intent.payload) : initialRequirementsDraft(result.value));
      } else { setReadDenied(result.status === "forbidden"); setMessage(reasons[result.status] ?? reasons.unavailable); }
      setLoading(false); heading.current?.focus();
    }).catch(() => { if (active && mounted.current && current === epoch.current) { setLoading(false); setMessage(reasons.unavailable); } });
    return () => { active = false; mounted.current = false; };
  }, [scope.organizationId, scope.membershipId, scope.studentCaseId, scope.applicationId]);
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const leave = (event: MouseEvent) => {
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target === "_blank" || anchor.download || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || anchor.getAttribute("href")?.startsWith("#")) return;
      if (!window.confirm(retained.intent ? "Результат сохранения пока неизвестен. Запрос останется в этом браузере. Перейти на другую страницу?" : "В списке есть несохранённые изменения. Перейти без сохранения?")) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener("beforeunload", beforeUnload); document.addEventListener("click", leave, true);
    return () => { window.removeEventListener("beforeunload", beforeUnload); document.removeEventListener("click", leave, true); };
  }, [dirty, retained.intent]);
  function change(next: RequirementsDraft) { setDraft(next); setReviewed(false); setProblems([]); }
  function focusProblem(problem: DraftProblem) {
    setOnlyUnresolved(false); setSourcesQuery("");
    if (problem.target.startsWith("source-") && base) setSourcePage(Math.floor(base.sources.findIndex(source => `source-${source.sourceKey}` === problem.target) / 20));
    requestAnimationFrame(() => { const element = document.getElementById(targetId(problem.target)); element?.scrollIntoView({ block: "center" }); element?.focus(); });
  }
  async function refresh() {
    if (busy.current) return;
    const current = ++epoch.current; setLoading(true);
    try {
      const result = await readStaffRequirementsEditorAction(owner, target);
      if (!mounted.current || current !== epoch.current) return;
      if (result.status === "ready") {
        setReadDenied(false);
        if (base && draft) { setFresh(result.value); setRebaseChoices({}); }
        else { setBase(result.value); setDraft(initialRequirementsDraft(result.value)); }
      } else { if (result.status === "forbidden") setReadDenied(true); setMessage(reasons[result.status] ?? reasons.unavailable); }
    } catch { if (mounted.current) setMessage(reasons.unavailable); }
    finally { if (mounted.current && current === epoch.current) setLoading(false); }
  }
  async function save(retry: boolean) {
    if (busy.current || (!retry && locked)) return;
    let intent = null;
    if (!retry) {
      if (!base || !draft) return;
      const errors = draftProblems(base, draft);
      if (!reviewed) errors.push({ target: "review", message: "Проверьте состав и прежние источники перед сохранением." });
      const payload = buildRequirementsPayload(base, draft);
      if (!payload && !errors.length) errors.push({ target: "items", message: "Проверьте сроки, длину текстов и выбранные материалы. Список не отправлен." });
      if (errors.length || !payload) { setProblems(errors); if (errors[0]) focusProblem(errors[0]); return; }
      intent = { ...target, requestId: crypto.randomUUID(), payload };
    }
    busy.current = true; setSending(true); setMessage(null);
    let ownsDraft = false;
    let savedRevision: string | null = null;
    try {
      const result = await sendEditorPending(scope, intent, pending => {
        // This is the exact intent selected under the cross-tab lock.
        ownsDraft = !!draft && requirementsDraftMatchesPayload(draft, pending.payload);
        return saveStaffRequirementsEditorAction(owner, pending);
      });
      if (!mounted.current) return;
      if (result.ok) {
        savedRevision = result.receipt.revisionVersion;
        setMessage(`Список сохранён. Редакция ${result.receipt.revisionVersion}.`); setNeedsRefresh(false); setFresh(null); setReviewed(false);
        // Receipt establishes success even if the separate readback is unavailable.
        const read = await readStaffRequirementsEditorAction(owner, target).catch(() => null);
        if (!mounted.current) return;
        if (read?.status === "ready") {
          setReadDenied(false);
          if (ownsDraft || !base || !draft) { setBase(read.value); setDraft(initialRequirementsDraft(read.value)); }
          else { setFresh(read.value); setRebaseChoices({}); setMessage(`Запрос сохранён. Редакция ${result.receipt.revisionVersion}. Ваш отдельный черновик сохранён ниже; сравните его с актуальным списком.`); }
        }
        else {
          if (read?.status === "forbidden") setReadDenied(true);
          setNeedsRefresh(true); setMessage(`Список сохранён. Редакция ${result.receipt.revisionVersion}. Обновить отображение пока не удалось.`);
        }
        onSaved();
      } else { setMessage(reasons[result.reason] ?? reasons.unavailable); if (result.reason === "stale_context") setNeedsRefresh(true); if (result.reason === "forbidden") setReadDenied(true); }
    } catch { if (mounted.current) setMessage(savedRevision ? `Список сохранён. Редакция ${savedRevision}. Обновить отображение пока не удалось.` : reasons.unavailable); }
    finally { busy.current = false; if (mounted.current) setSending(false); }
  }
  const used = new Set(draft?.items.flatMap(item => item.material?.kind === "existing" ? [item.material.documentSlotId] : []) ?? []);
  const visibleSources = base?.sources.filter(source => {
    const decision = draft?.sourceDecisions.find(decision => decision.sourceKey === source.sourceKey);
    return (!onlyUnresolved || !decision?.disposition) && `${source.label ?? ""} ${sourceLabel(source)}`.toLocaleLowerCase("ru").includes(sourcesQuery.toLocaleLowerCase("ru"));
  }) ?? [];
  const pages = Math.max(1, Math.ceil(visibleSources.length / 20));
  const currentPage = Math.min(Math.max(sourcePage, 0), pages - 1);
  const unresolved = draft?.sourceDecisions.filter(decision => decision.disposition === null).length ?? 0;
  const conflicts = base && fresh && draft ? requirementsRebaseConflicts(base, fresh, draft) : [];
  return <section aria-busy={loading || sending} className="min-w-0 space-y-4 border-t border-border pt-4">
    <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><h4 ref={heading} tabIndex={-1} className="t-section text-fg">Список документов программы</h4>{base ? <p className="mt-1 break-words text-sm text-fg-2">{base.binding.programTitle} · {base.binding.intakeLabel} · {base.requirements.revisionVersion ? `редакция ${base.requirements.revisionVersion}` : "список ещё не подтверждён"}</p> : null}</div><button type="button" className={btnGhostCls} disabled={sending} onClick={() => { if (!dirty || window.confirm(retained.intent ? "Запрос с неизвестным исходом останется в браузере. Закрыть редактор?" : "Закрыть редактор без сохранения изменений?")) onClose(); }}>Закрыть редактор</button></div>
    {loading ? <p role="status" className="text-sm text-fg-3">Читаем документы и прежние требования…</p> : null}
    {message ? <p role="status" className="max-w-2xl text-sm leading-6 text-fg-2">{message}</p> : null}
    {retained.blocked ? <p role="alert" className="text-sm text-danger">Не удалось проверить сохранённый запрос. Новые изменения не отправляются.</p> : null}
    {retained.intent ? <div className="space-y-2"><p className="max-w-2xl text-sm leading-6 text-fg-2">В браузере сохранён запрос, результат которого нужно проверить. Его содержимое остаётся неизменным при повторе.</p><details hidden={readDenied}><summary className="cursor-pointer py-2 text-sm font-semibold text-fg">Состав сохранённого запроса</summary><ol className="list-decimal space-y-1 pl-5 text-sm text-fg-2">{retained.intent.payload.items.map(item => <li key={item.requirementKey}>{item.label} · {item.required ? "обязательно" : "необязательно"}</li>)}</ol><p className="mt-2 whitespace-pre-wrap break-words text-sm text-fg-2">{retained.intent.payload.changeReason}</p></details><button type="button" className={btnCls} disabled={sending || retained.blocked} onClick={() => void save(true)}>{sending ? "Проверяем сохранение…" : "Повторить сохранённый запрос"}</button></div> : null}
    <button type="button" className={btnGhostCls} disabled={loading || sending} onClick={() => void refresh()}>Загрузить актуальные сведения</button>
    {base?.saveBlockReason ? <p className="text-sm text-fg-2">{blockedReasons[base.saveBlockReason]}</p> : null}
    {fresh && base && !readDenied ? <section className="space-y-3 rounded-card border border-border bg-surface-2 p-4"><h5 className="t-item text-fg">Изменения с момента открытия</h5><ul className="list-disc space-y-1 pl-5 text-sm text-fg-2">{contextChanges(base, fresh).map((message, index) => <li key={index}>{message}</li>)}</ul><p className="text-sm text-fg-2">Ваши правки остаются ниже. Нетронутые поля и новые пункты обновятся из актуального списка. Для конфликтов выберите значение; новые или изменившиеся источники потребуют решения.</p>{conflicts.map(conflict => <fieldset key={conflict.id} className="min-w-0 space-y-2 border-t border-border pt-3"><legend className="break-words pt-3 text-sm font-semibold text-fg">{conflict.label}</legend>{([ ["local", conflict.local], ["current", conflict.current] ] as const).map(([value, text]) => <label key={value} className="flex items-start gap-2 py-2 text-sm text-fg-2"><input type="radio" className="mt-1 size-5 shrink-0 accent-accent" name={`${prefix}-conflict-${conflict.id}`} checked={rebaseChoices[conflict.id] === value} onChange={() => setRebaseChoices({ ...rebaseChoices, [conflict.id]: value })} /><span className="min-w-0 whitespace-pre-wrap break-words"><span className="font-medium">{value === "local" ? "Мой вариант: " : "Актуальный: "}</span>{text}</span></label>)}{conflict.restoredAsNew ? <p className="text-sm text-fg-3">При выборе своего варианта создаётся новый пункт. Основание соответствия документа нужно указать заново.</p> : null}</fieldset>)}<button type="button" className={`${btnGhostCls} h-auto min-h-11 whitespace-normal py-2`} disabled={!!retained.intent || sending || conflicts.some(conflict => !rebaseChoices[conflict.id])} onClick={() => { if (draft) { change(rebaseRequirementsDraft(base, fresh, draft, rebaseChoices)); setBase(fresh); setFresh(null); setRebaseChoices({}); setNeedsRefresh(false); setMessage(null); } }}>Продолжить с актуальными сведениями</button></section> : null}
    {base && draft && !readDenied ? <form noValidate onSubmit={event => { event.preventDefault(); void save(false); }}>
      {problems.length ? <div role="alert" className="mb-4 space-y-1 text-sm text-danger"><p className="font-semibold">Проверьте перед сохранением:</p>{problems.map((problem, index) => <button key={index} type="button" className="block py-1 text-left underline underline-offset-4" onClick={() => focusProblem(problem)}>{problem.message}</button>)}</div> : null}
      <fieldset disabled={locked} className="min-w-0"><legend className="text-base font-semibold text-fg">Требования ({draft.items.length})</legend>
        <div id={targetId("items")} tabIndex={-1}>{draft.items.map((item, index) => <ItemFields key={item.requirementKey} id={targetId(`item-${item.requirementKey}`)} item={item} index={index} count={draft.items.length} context={base} used={used} disabled={locked}
          update={next => change({ ...draft, items: draft.items.map(old => old.requirementKey === item.requirementKey ? next : old) })}
          remove={() => { if (window.confirm(`Убрать пункт «${item.label || "Новое требование"}» из этого списка? Документ останется в деле.`)) change({ ...draft, items: draft.items.filter(old => old.requirementKey !== item.requirementKey), sourceDecisions: draft.sourceDecisions.map(decision => decision.requirementKey === item.requirementKey ? { ...decision, disposition: null, requirementKey: null } : decision) }); }}
          move={offset => { const items = [...draft.items]; [items[index], items[index + offset]] = [items[index + offset], items[index]]; change({ ...draft, items }); }} />)}</div>
        <button type="button" className={`${btnGhostCls} mt-3`} disabled={draft.items.length >= 100} onClick={() => change({ ...draft, items: [...draft.items, newRequirementsDraftItem(`r.${crypto.randomUUID()}`)] })}>Добавить требование</button>
        <section className="mt-7 space-y-3"><h5 className="t-item text-fg">Прежние источники{unresolved ? ` · нужно решение: ${unresolved}` : ""}</h5><p className="max-w-2xl text-sm leading-6 text-fg-2">Учтите каждый источник. Исключение из этого списка не удаляет документ и не меняет настройки заявки.</p>
          {base.legacyApplication.documentsApplicability ? <details><summary className="cursor-pointer py-2 text-sm font-semibold text-fg">Текущие настройки документов заявки</summary><dl className="grid gap-2 text-sm text-fg-2"><div><dt>Применимость</dt><dd>{base.legacyApplication.documentsApplicability === "required" ? "Документы требуются" : base.legacyApplication.documentsApplicability === "not_required" ? "Документы не требуются" : "Нужно подтвердить"}</dd></div>{([ ["documentsSource", "Источник"], ["documentsCheckedOn", "Дата проверки"], ["documentsExceptionReason", "Причина исключения"], ["documentsExceptionEvidence", "Подтверждение исключения"] ] as const).map(([key, label]) => base.legacyApplication[key] ? <div key={key}><dt className="font-medium">{label}</dt><dd className="whitespace-pre-wrap break-words">{base.legacyApplication[key]}</dd></div> : null)}</dl></details> : null}
          {base.sources.length ? <><Field label="Найти прежний источник"><input className={inputCls} type="search" value={sourcesQuery} onChange={event => { setSourcesQuery(event.target.value); setSourcePage(0); }} /></Field><label className="flex min-h-11 items-center gap-2 text-sm text-fg"><input type="checkbox" className="size-5 accent-accent" checked={onlyUnresolved} onChange={event => { setOnlyUnresolved(event.target.checked); setSourcePage(0); }} />Только без решения</label>
            <div className="divide-y divide-border">{visibleSources.slice(currentPage * 20, currentPage * 20 + 20).map(source => {
              const decision = draft.sourceDecisions.find(decision => decision.sourceKey === source.sourceKey)!;
              const included = draft.items.find(item => item.requirementKey === decision.requirementKey);
              const needReason = decision.disposition === "excluded" || (source.required && included && !included.required);
              const choose = (value: string) => change({ ...draft, sourceDecisions: draft.sourceDecisions.map(old => old.sourceKey === source.sourceKey ? { ...old, disposition: value === "exclude" ? "excluded" : value ? "included" : null, requirementKey: value && value !== "exclude" ? value : null } : old) });
              return <section key={source.sourceKey} id={targetId(`source-${source.sourceKey}`)} tabIndex={-1} className="space-y-2 py-3"><h6 className="t-item break-words text-fg">{source.label ?? "Документ не найден"}</h6><p className="text-sm text-fg-3">{sourceLabel(source)}{source.required === true ? " · обязательный" : source.required === false ? " · необязательный" : " · обязательность в источнике не определена"}{source.materialState !== "selectable" ? " · материал недоступен" : ""}</p>{source.legacyException ? <p className="text-sm text-fg-2">В заявке уже записано исключение проверки этого файла. Оно сохранится.</p> : null}{source.mustRetain ? <p className="text-sm text-fg-2">Выбран в настройках заявки: должен остаться в списке.</p> : null}
                <Field label="Как учесть источник"><select className={inputCls} value={decision.disposition === "excluded" ? "exclude" : decision.requirementKey ?? ""} onChange={event => choose(event.target.value)}><option value="">Выберите решение</option>{draft.items.filter(item => sourceCanUseItem(source, item, base)).map(item => <option key={item.requirementKey} value={item.requirementKey}>Включить: {item.label || "Новый пункт"}</option>)}<option value="exclude" disabled={source.mustRetain}>Не переносить в этот список</option></select></Field>
                {needReason ? <Field label="Причина решения"><textarea className={areaCls} value={decision.reason ?? ""} onChange={event => change({ ...draft, sourceDecisions: draft.sourceDecisions.map(old => old.sourceKey === source.sourceKey ? { ...old, reason: event.target.value || null } : old) })} /></Field> : null}
                {source.instructions ? <details><summary className="cursor-pointer py-2 text-sm text-fg-2">Инструкция источника</summary><p className="whitespace-pre-wrap break-words text-sm leading-6 text-fg-2">{source.instructions}</p></details> : null}
              </section>;
            })}</div><div className="flex flex-wrap items-center gap-2"><button type="button" className={btnGhostCls} disabled={currentPage === 0} onClick={() => setSourcePage(currentPage - 1)}>Предыдущие</button><span className="text-sm text-fg-3">Страница {currentPage + 1} из {pages} · найдено {visibleSources.length}</span><button type="button" className={btnGhostCls} disabled={currentPage + 1 >= pages} onClick={() => setSourcePage(currentPage + 1)}>Следующие</button></div></> : <p className="text-sm text-fg-3">Прежних источников для переноса нет.</p>}
        </section>
        <section id={targetId("review")} tabIndex={-1} className="mt-7 space-y-3"><h5 className="t-item text-fg">Перед сохранением</h5>{requirementChanges(base, draft).length ? <ul className="list-disc space-y-1 pl-5 text-sm text-fg-2">{requirementChanges(base, draft).map((change, index) => <li key={index}>{change}</li>)}</ul> : <p className="text-sm text-fg-2">Состав и документы остаются прежними. Подтверждение сохранится новой редакцией.</p>}<p className="max-w-2xl text-sm leading-6 text-fg-2">Подтверждение списка не одобряет файлы. При изменении требований проверьте, подходит ли ранее принятая версия документа.</p><div id={targetId("reason")} tabIndex={-1}><Field label="Основание подтверждения или изменений"><textarea className={areaCls} value={draft.changeReason} onChange={event => change({ ...draft, changeReason: event.target.value })} /></Field></div><label className="flex min-h-11 items-start gap-2 py-2 text-sm text-fg"><input type="checkbox" className="mt-0.5 size-5 shrink-0 accent-accent" checked={reviewed} onChange={event => setReviewed(event.target.checked)} />Я проверил(а) состав, материалы и решения по прежним источникам</label><button type="submit" className={btnCls} disabled={locked || loading}>{sending ? "Сохраняем…" : "Сохранить список"}</button></section>
      </fieldset>
    </form> : null}
  </section>;
}
