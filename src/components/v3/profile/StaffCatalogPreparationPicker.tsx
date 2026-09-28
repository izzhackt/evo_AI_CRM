"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons";
import { btnCls, btnGhostCls, inputCls, fieldLabelCls } from "@/components/ui";
import { UNIVERSITY_LEVEL_LABELS, universityIntakeLabel, type PublishedUniversity, type UniversityIntake, type UniversityPage, type UniversityProgram } from "@/lib/platform-university-catalog";
import type { CatalogPreparation, CatalogPreparationIntent } from "@/lib/portal/catalog-preparations";
import { readStaffPreparationsAction, searchStaffPreparationCatalogAction, selectStaffPreparationAction, type StaffPreparationRead } from "@/lib/v3/staff-catalog-preparation-actions";
import { country } from "@/lib/v3/wording";
import { QUEUE_SECONDARY } from "../queue/queue-buttons";
import styles from "./ApplicationCreateDialog.module.css";
import { clearStaffPending, continueStaffRequirements, preparationError, useStaffPending, saveStaffPending, type StaffPreparationScope } from "./staff-preparation-client";

const countries = new Set(["CN", "MY", "AE", "TR", "IT", "CZ"]);
/** Страны каталога словами: «Китай, Малайзия, …» — чтобы было видно, когда нужен ручной ввод. */
const COUNTRY_WORDS = [...countries].map((code) => country(code)).filter((word): word is string => word !== null).join(", ");

type PickerProps = {
  scope: StaffPreparationScope;
  canSelect: boolean;
  canInitialize: boolean;
  initialPreparations: StaffPreparationRead<readonly CatalogPreparation[]>;
};

/**
 * «+ Вуз из каталога» (Э8.2): одна кнопка добавления на «Вузах и программах»
 * открывает прежний выбор программы и набора в окне верхнего слоя (та же
 * оболочка, что у «Добавить вручную»). Окно остаётся в разметке закрытым —
 * набранный поиск не теряется. Сплошной красной кнопка бывает, только когда
 * это главное действие страницы (`primary`): если у заголовка дела уже есть
 * «Принять дело», она нейтральная. Запрос выбора без подтверждённого
 * результата виден строкой рядом с кнопкой и в самом окне.
 */
export function CatalogPreparationLauncher({ primary, ...picker }: PickerProps & { primary: boolean }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const leaving = useRef(false);
  const titleId = useId();
  const { intent: retained, blocked } = useStaffPending(picker.scope, "selection");
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const onClose = () => {
      // Переход к подготовке уводит фокус на неё; иначе он возвращается на кнопку.
      if (!leaving.current && triggerRef.current?.isConnected) triggerRef.current.focus();
      leaving.current = false;
    };
    dialog.addEventListener("close", onClose);
    return () => dialog.removeEventListener("close", onClose);
  }, []);
  const open = () => {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    dialog.showModal();
    // Поле внутри <dialog> фокусируется только после showModal(): фокус — сразу на поиск вуза.
    dialog.querySelector<HTMLElement>('input[type="search"]')?.focus();
  };
  const leave = (applicationId: string) => {
    leaving.current = true;
    dialogRef.current?.close();
    requestAnimationFrame(() => document.getElementById(`preparation-${applicationId}`)
      ?.querySelector<HTMLElement>(":scope > button")?.focus({ preventScroll: true }));
  };
  return <>
    {retained || blocked ? <p role="status" className="order-last basis-full t-body-compact text-fg-2">
      {/* Хранилище браузера не читается — это ещё не неподтверждённый выбор; слова — как в окне. */}
      {retained ? "Выбор из каталога не подтверждён." : "Не удалось прочитать сохранённый запрос."}{" "}
      <button type="button" className="inline-flex min-h-11 items-center t-label text-fg underline underline-offset-4" onClick={open}>Проверить</button>
    </p> : null}
    <button ref={triggerRef} type="button" className={primary ? btnCls : QUEUE_SECONDARY} aria-haspopup="dialog" onClick={open} data-testid="v3-catalog-preparation-launcher">
      <Icon name="plus" size={18} className="shrink-0" />
      Вуз из каталога
    </button>
    <dialog ref={dialogRef} className={styles.dialog} aria-labelledby={titleId} data-testid="v3-catalog-preparation-dialog">
      <div className={styles.layout}>
        <header className={styles.header}>
          <h2 id={titleId}>Вуз из каталога</h2>
          <button type="button" className={btnGhostCls} onClick={() => dialogRef.current?.close()}>Закрыть</button>
        </header>
        <div className={styles.body}>
          <StaffCatalogPreparationPicker {...picker} onLeave={leave} />
        </div>
      </div>
    </dialog>
  </>;
}

function StaffCatalogPreparationPicker({ scope, canSelect, canInitialize, initialPreparations, onLeave }: PickerProps & {
  /** Переход к сохранённой подготовке: окно закрывается, фокус — на её раскрытии в строке вуза. */
  onLeave: (applicationId: string) => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState<UniversityPage | null>(null);
  const [catalogStatus, setCatalogStatus] = useState<"idle" | "loading" | "ready" | "unavailable" | "forbidden">("idle");
  const [university, setUniversity] = useState<PublishedUniversity | null>(null);
  const [fresh, setFresh] = useState<{ source: typeof initialPreparations; value: typeof initialPreparations } | null>(null);
  const preparations = fresh?.source === initialPreparations ? fresh.value : initialPreparations;
  const setPreparations = (value: typeof initialPreparations) => setFresh({ source: initialPreparations, value });
  const [message, setMessage] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const { intent: retained, blocked: storageBlocked } = useStaffPending(scope, "selection");
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const epoch = useRef(0);

  async function search(offset = 0) {
    const current = ++epoch.current;
    setCatalogStatus("loading"); setUniversity(null); setMessage(null);
    try {
      const result = await searchStaffPreparationCatalogAction({ query, offset, institutionId: null });
      if (current !== epoch.current) return;
      if (result.status === "ready") { setPage(result.value); setCatalogStatus("ready"); }
      else { setPage(null); setCatalogStatus(result.status === "forbidden" ? "forbidden" : "unavailable"); }
    } catch { if (current === epoch.current) { setPage(null); setCatalogStatus("unavailable"); } }
  }
  function open(applicationId: string, leave = false) {
    setSavedId(applicationId);
    // This is an anchor within the current canonical case page, not a new route.
    window.history.replaceState(window.history.state, "", `#preparation-${applicationId}`);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    // Новая подготовка появится в списке после перечитывания: окно остаётся с итогом и
    // ссылкой «К сохранённой подготовке». К уже сохранённой — переход сразу.
    if (leave) onLeave(applicationId);
    document.getElementById(`preparation-${applicationId}`)?.scrollIntoView({ block: "start" });
    router.refresh();
  }
  async function checkSaved() {
    if (busy.current) return;
    busy.current = true; setPending(true);
    try {
      const current = await readStaffPreparationsAction(scope.studentCaseId);
      setPreparations(current);
      if (current.status !== "ready") { setMessage("Не удалось прочитать сохранённые подготовки. Новый выбор не отправлен."); return; }
      if (retained) {
        const existing = current.value.find((item) => item.institutionId === retained.institutionId && item.programId === retained.programId && item.intakeId === retained.intakeId);
        if (existing) { setMessage("Подготовка найдена. Её можно открыть; сохранённый запрос доступен для точного повтора."); open(existing.applicationId); return; }
      }
      setMessage("Сохранённые подготовки обновлены."); router.refresh();
    } catch { setMessage("Не удалось прочитать сохранённые подготовки. Повторите проверку."); }
    finally { busy.current = false; setPending(false); }
  }
  async function send(intent: CatalogPreparationIntent) {
    const result = await selectStaffPreparationAction(scope, intent);
    if (!result.ok) {
      if (result.reason !== "unavailable") clearStaffPending(scope, intent);
      setMessage(preparationError[result.reason]); return;
    }
    clearStaffPending(scope, intent); setSavedId(result.receipt.applicationId);
    // 214 is already committed. A failed218 read/command cannot turn it into a failed selection.
    let notice = "Программа выбрана. Подготовка сохранена.";
    if (canInitialize) {
      try { notice = await continueStaffRequirements(scope, result.receipt.applicationId) ?? notice; }
      catch { notice = "Программа выбрана. Документы пока не удалось подготовить. Продолжите из сохранённой заявки."; }
    }
    setMessage(notice); open(result.receipt.applicationId);
  }
  async function choose(program: UniversityProgram, intake: UniversityIntake) {
    if (busy.current || !university || storageBlocked || retained) return;
    busy.current = true; setPending(true); setMessage(null);
    try {
      // Fresh successful case read comes before any new intent. Existing bindings
      // reopen even if the publication, deadline or case status has since changed.
      const current = await readStaffPreparationsAction(scope.studentCaseId);
      setPreparations(current);
      if (current.status !== "ready") { setMessage("Не удалось проверить сохранённые подготовки. Новый выбор не отправлен."); return; }
      const existing = current.value.find((item) => item.institutionId === university.id && item.programId === program.id && item.intakeId === intake.id);
      if (existing) { open(existing.applicationId, true); return; }
      if (!canSelect || !intake.id || intake.status === "closed" || !countries.has(university.content.country)) return;
      const latest = await searchStaffPreparationCatalogAction({ query: "", offset: 0, institutionId: university.id });
      const published = latest.status === "ready" ? latest.value.items.find((item) => item.id === university.id) : null;
      if (!published) { setMessage("Не удалось перечитать карточку университета. Новый выбор не отправлен."); return; }
      if (published.version !== university.version) { setUniversity(published); setMessage(preparationError.stale_publication); return; }
      const intent: CatalogPreparationIntent = { studentCaseId: scope.studentCaseId, institutionId: university.id, publicationVersion: university.version, programId: program.id, intakeId: intake.id, requestId: crypto.randomUUID() };
      saveStaffPending(scope, intent);
      await send(intent);
    } catch { setMessage("Результат не подтверждён. Если запрос сохранён, повторите его; новый запрос автоматически не отправляется."); }
    finally { busy.current = false; setPending(false); }
  }
  async function retry() {
    if (busy.current || !retained || storageBlocked) return;
    busy.current = true; setPending(true); setMessage(null);
    try { await send(retained); }
    catch { setMessage(preparationError.unavailable); }
    finally { busy.current = false; setPending(false); }
  }
  return <div className="space-y-4" aria-busy={pending} data-testid="staff-catalog-preparation-picker">
      <p className="t-body-compact text-fg-2">В каталоге — {COUNTRY_WORDS}. Выбор сразу открывает подготовку документов; это ещё не подача в университет. Вуза нет в каталоге — добавьте его вручную.</p>
      {storageBlocked ? <p role="alert" className="text-sm text-danger">Не удалось прочитать сохранённый запрос в этой сессии. Новый запрос не отправляется. Проверьте сохранённые подготовки.</p> : null}
      {retained ? <div className="space-y-2"><p className="text-sm text-fg-2">Есть запрос выбора без подтверждённого результата.</p><button className={btnGhostCls} type="button" disabled={pending || storageBlocked} onClick={() => void retry()}>Повторить сохранённый запрос</button></div> : null}
      {preparations.status !== "ready" ? <p role="alert" className="text-sm text-danger">Сохранённые подготовки сейчас недоступны. Новый выбор временно отключён.</p> : null}
      {retained || storageBlocked || preparations.status !== "ready" ? <button type="button" className={btnGhostCls} disabled={pending} onClick={() => void checkSaved()}>Проверить сохранённые подготовки</button> : null}
      <form className="flex flex-col gap-2 sm:flex-row sm:items-end" onSubmit={(event) => { event.preventDefault(); void search(); }}>
        <label className={`${fieldLabelCls} min-w-0 flex-1`}>Университет<input type="search" className={`${inputCls} mt-1`} value={query} maxLength={100} disabled={pending} placeholder="Название университета" onChange={(event) => { ++epoch.current; setQuery(event.target.value); setPage(null); setUniversity(null); setCatalogStatus("idle"); }} /></label>
        <button type="submit" className={btnGhostCls} disabled={pending || catalogStatus === "loading"}>Найти</button>
      </form>
      {catalogStatus === "loading" ? <p role="status" className="text-sm text-fg-3">Ищем опубликованные программы…</p> : null}
      {catalogStatus === "unavailable" ? <p role="alert" className="text-sm text-danger">Каталог не удалось прочитать. Повторите поиск. Ручное добавление остаётся доступным.</p> : null}
      {catalogStatus === "forbidden" ? <p role="status" className="text-sm text-fg-2">Нет доступа к каталогу.</p> : null}
      {page && !university ? <>
        {page.items.length ? <ul className="divide-y divide-border">{page.items.map((item) => <li key={item.id} className="py-2"><button type="button" className="min-h-11 w-full rounded-ctl px-2 py-2 text-left text-sm font-medium text-fg hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent" disabled={pending} onClick={() => setUniversity(item)}>{item.content.name}<span className="ml-2 font-normal text-fg-3">{item.content.city ?? item.content.country}</span></button></li>)}</ul> : <p className="text-sm text-fg-2">По этому запросу университетов нет. Попробуйте другое название.</p>}
        {page.nextOffset !== null ? <button className={btnGhostCls} type="button" disabled={pending} onClick={() => void search(page.nextOffset!)}>Следующие университеты</button> : null}
      </> : null}
      {university ? <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="t-item min-w-0 break-words text-fg">{university.content.name}</h4><button type="button" className={btnGhostCls} disabled={pending} onClick={() => setUniversity(null)}>Другой университет</button></div>
        <a href={`/v3/universities/${university.id}`} className="inline-flex min-h-11 items-center text-sm text-accent-text underline underline-offset-4">Карточка университета и источники</a>
        {!countries.has(university.content.country) ? <p className="text-sm text-fg-2">Для этой страны пока доступно ручное добавление заявки.</p> : null}
        {university.content.programs.map((program) => <section key={program.id} className="border-t border-border pt-3">
          <h5 className="t-item break-words text-fg">{program.title}</h5><p className="mt-1 text-sm text-fg-3">{UNIVERSITY_LEVEL_LABELS[program.level]}{program.language ? ` · ${program.language}` : ""}</p>
          {!program.intakes.length ? <p className="py-2 text-sm text-fg-2">Сведения о наборах ещё не опубликованы.</p> : <ul className="mt-2 divide-y divide-border">{program.intakes.map((intake, index) => {
            const existing = preparations.status === "ready" ? preparations.value.find((item) => item.institutionId === university.id && item.programId === program.id && item.intakeId === intake.id) : undefined;
            return <li key={intake.id ?? `legacy-${index}`} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0"><p className="break-words text-sm font-medium text-fg">{intake.label}</p><p className="mt-1 text-sm text-fg-3">{universityIntakeLabel(intake)}</p>{intake.applicationDeadline ? <p className="mt-1 text-sm text-fg-3">Опубликованная дата: {intake.applicationDeadline}{intake.deadlineTime ? ` ${intake.deadlineTime}` : ""}{intake.timezone ? ` (${intake.timezone})` : ""}</p> : null}{!intake.id ? <p className="mt-1 text-sm text-fg-3">Сведения о наборе нужно уточнить перед выбором.</p> : null}</div>
              <button type="button" className={`${btnGhostCls} shrink-0`} disabled={pending || preparations.status !== "ready" || (!existing && (!!retained || storageBlocked || !canSelect || !intake.id || intake.status === "closed" || !countries.has(university.content.country)))} onClick={() => existing ? open(existing.applicationId, true) : void choose(program, intake)}>{existing ? "Открыть подготовку" : "Начать подготовку"}</button>
            </li>;
          })}</ul>}
        </section>)}
      </div> : null}
      {message ? <p role="status" className="text-sm leading-6 text-fg-2">{message}</p> : null}
      {savedId ? <a href={`#preparation-${savedId}`} className={btnGhostCls} onClick={() => open(savedId, true)}>К сохранённой подготовке</a> : null}
  </div>;
}
