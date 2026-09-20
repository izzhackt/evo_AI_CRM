"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { btnCls, btnGhostCls } from "@/components/ui";
import type { CatalogPreparation } from "@/lib/portal/catalog-preparations";
import type { ApplicationRequirementItem, ApplicationRequirements } from "@/lib/portal/application-requirements";
import { readStaffPreparationRequirementsAction, type StaffPreparationRead } from "@/lib/v3/staff-catalog-preparation-actions";
import { continueStaffRequirements, useStaffPending, type StaffPreparationScope } from "./staff-preparation-client";

function subscribeHash(callback: () => void) {
  window.addEventListener("hashchange", callback);
  return () => window.removeEventListener("hashchange", callback);
}

const associations = new Set(["slot_missing", "slot_removed", "application_link_missing", "slot_metadata_changed"]);
function fileState(item: ApplicationRequirementItem): string {
  if (item.unavailableReasons.some((reason) => associations.has(reason))) return "Связь с документом требует проверки";
  if (item.unavailableReasons.includes("file_missing")) return "Файл ещё не загружен";
  if (item.technicalAvailability === "available") return "Файл доступен";
  if (item.unavailableReasons.includes("malware_infected")) return "Файл заблокирован проверкой безопасности";
  if (item.unavailableReasons.some((reason) => ["integrity_failed", "malware_error"].includes(reason))) return "Не удалось подтвердить безопасность файла";
  return "Файл проходит техническую проверку";
}
function reviewState(item: ApplicationRequirementItem): string {
  if (item.unavailableReasons.some((reason) => associations.has(reason))) return "Состояние проверки сотрудником недоступно";
  if (item.reviewDecision === "approved") return "Проверка сотрудником: принят";
  if (item.reviewDecision === "correction_required") return "Проверка сотрудником: нужны исправления";
  if (item.reviewDecision === "rejected") return "Проверка сотрудником: отклонён";
  return item.currentVersionId ? "Решение сотрудника ещё не получено" : "Проверка сотрудником: файла пока нет";
}

export function StaffPreparationPanel({ preparation, scope, canRead, canInitialize }: {
  preparation: CatalogPreparation;
  scope: StaffPreparationScope;
  canRead: boolean;
  canInitialize: boolean;
}) {
  const [explicitOpen, setOpened] = useState(false);
  const [view, setView] = useState<StaffPreparationRead<ApplicationRequirements> | null>(null);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const { intent: retained, blocked: storageBlocked } = useStaffPending(scope, "requirements", preparation.applicationId);
  const [message, setMessage] = useState<string | null>(null);
  const busy = useRef(false);
  const epoch = useRef(0);
  const id = `preparation-${preparation.applicationId}`;
  const hash = useSyncExternalStore(subscribeHash, () => window.location.hash, () => "");
  const anchorOpen = hash === `#${id}`;
  const opened = explicitOpen || anchorOpen;
  const docsHref = `/v3/profile?case=${scope.studentCaseId}&tab=documents`;
  const program = preparation.content.programs.find((item) => item.id === preparation.programId)!;
  const intake = program.intakes.find((item) => item.id === preparation.intakeId)!;
  const load = useCallback(async () => {
    if (!canRead) return;
    const request = ++epoch.current;
    setLoading(true);
    try {
      const result = await readStaffPreparationRequirementsAction({ studentCaseId: scope.studentCaseId, applicationId: preparation.applicationId });
      if (request === epoch.current) setView(result);
    } catch {
      if (request === epoch.current) setView({ status: "unavailable" });
    } finally {
      if (request === epoch.current) setLoading(false);
    }
  }, [canRead, scope.studentCaseId, preparation.applicationId]);
  useEffect(() => {
    // Opening an anchor only reads. No initialization or replay happens on mount.
    if (!anchorOpen || !canRead) return;
    let active = true;
    const request = ++epoch.current;
    void readStaffPreparationRequirementsAction({ studentCaseId: scope.studentCaseId, applicationId: preparation.applicationId })
      .then((result) => { if (active && request === epoch.current) setView(result); })
      .catch(() => { if (active && request === epoch.current) setView({ status: "unavailable" }); });
    return () => { active = false; };
  }, [anchorOpen, canRead, preparation.applicationId, scope.studentCaseId]);

  async function initialize() {
    if (busy.current || !canInitialize || !canRead || storageBlocked) return;
    busy.current = true; setPending(true); setMessage(null);
    try {
      setMessage(await continueStaffRequirements(scope, preparation.applicationId));
      await load();
    } catch {
      setMessage("Результат не подтверждён. Если запрос сохранён, повтор будет отправлен с тем же номером.");
    } finally { busy.current = false; setPending(false); }
  }
  const requirements = view?.status === "ready" ? view.value : null;
  return <section id={id} className="mt-4 scroll-mt-6 border-t border-border pt-3" aria-label="Подготовка по выбранной программе">
    <p className="text-sm text-fg-2">Набор: {intake.label}</p>
    <p className="mt-1 text-sm text-fg-3">{preparation.deadlineStateAtSelection === "needs_confirmation" ? "Срок набора нужно подтвердить" : "Срок сохранён при выборе"}{intake.applicationDeadline ? ` · ${intake.applicationDeadline}` : ""}</p>
    <button type="button" className={`${btnGhostCls} mt-3`} aria-expanded={opened} aria-controls={`${id}-documents`} onClick={() => {
      setOpened(!opened);
      if (!opened) void load();
      else if (anchorOpen) {
        window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}`);
        window.dispatchEvent(new HashChangeEvent("hashchange"));
      }
    }}>
      {opened ? "Скрыть подготовку" : "Открыть подготовку"}
    </button>
    {opened ? <div id={`${id}-documents`} className="mt-4 space-y-3" aria-busy={loading || pending}>
      <h4 className="font-semibold text-fg">Документы программы</h4>
      {requirements?.origin === "evo_starter" ? <p className="max-w-2xl text-sm leading-6 text-fg-2">Фото и паспорт — стартовые документы. Полный список для программы ещё нужно уточнить.</p> : null}
      {!canRead || view?.status === "forbidden" ? <p className="text-sm text-fg-2">Выбор программы сохранён. Нет доступа к чтению документов этого дела.</p> : <>
        {loading || !view ? <p role="status" className="text-sm text-fg-3">Загружаем текущие документы…</p> : null}
        {view && view.status !== "ready" ? <p role="alert" className="text-sm text-danger">Не удалось прочитать документы. Сохранённая подготовка остаётся доступной.</p> : null}
        {requirements?.state === "needs_configuration" ? <p role="status" className="text-sm leading-6 text-fg-2">Перечень или связи документов требуют настройки сотрудником. Существующий список не заменён.</p> : null}
        {requirements?.state === "uninitialized" ? <p className="text-sm text-fg-2">Стартовый список ещё не открыт.{!canInitialize ? " Для продолжения нужно право на подготовку документов и активное дело." : ""}</p> : null}
        {requirements?.items.length ? <ul className="divide-y divide-border">{requirements.items.map((item) => <li key={item.requirementItemId} className="py-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className="min-w-0 break-words font-medium text-fg">{item.label} <span className="text-sm font-normal text-fg-3">{item.required ? "Обязательно" : "По необходимости"}</span></p>
            {!item.unavailableReasons.some((reason) => associations.has(reason)) ? <a className={btnGhostCls} href={`${docsHref}#document-${item.documentSlotId}`}>Открыть в документах</a> : null}
          </div>
          <p className="mt-1 text-sm text-fg-2">{fileState(item)}</p>
          <p className="mt-1 text-sm text-fg-3">{reviewState(item)}</p>
          {item.reviewReason ? <p className="mt-1 text-sm text-fg-2">{item.reviewReason}</p> : null}
          {item.instructions ? <p className="mt-2 max-w-2xl text-sm text-fg-3">{item.instructions}</p> : null}
        </li>)}</ul> : null}
        {storageBlocked ? <p role="alert" className="text-sm text-danger">Не удалось прочитать сохранённый запрос. Новое действие не отправляется.</p> : null}
        {canInitialize && (retained || requirements?.state === "uninitialized") ? <button type="button" disabled={pending || loading || storageBlocked} className={btnCls} onClick={() => void initialize()}>{pending ? "Подготавливаем…" : retained ? "Повторить сохранённый запрос" : "Продолжить подготовку"}</button> : null}
        <div className="flex flex-wrap gap-2"><button type="button" className={btnGhostCls} disabled={loading || pending} onClick={() => void load()}>Обновить документы</button><a href={docsHref} className={btnGhostCls}>Все документы дела</a></div>
        <p className="text-sm text-fg-3">Загрузка в разделе документов сразу отправляет файл на проверку сотруднику.</p>
      </>}
      {message ? <p role="alert" className="text-sm text-danger">{message}</p> : null}
    </div> : null}
  </section>;
}
