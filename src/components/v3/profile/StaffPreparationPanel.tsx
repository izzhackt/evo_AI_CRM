"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { btnCls, btnGhostCls } from "@/components/ui";
import type { CatalogPreparation } from "@/lib/portal/catalog-preparations";
import type { ApplicationPackageReadiness } from "@/lib/portal/application-packages";
import { readStaffApplicationPackageReadinessAction } from "@/lib/portal/application-packages-actions";
import { getPortalStrings } from "@/lib/portal/i18n";
import { ProgramDocumentItem } from "@/components/portal/admissionPreparations/ProgramDocumentItem";
import { ProgramDocumentHistory } from "@/components/portal/admissionPreparations/ProgramDocumentHistory";
import { ProgramDocumentRecovery } from "@/components/portal/admissionPreparations/ProgramDocumentRecovery";
import type { StaffPreparationRead } from "@/lib/v3/staff-catalog-preparation-actions";
import { continueStaffRequirements, useStaffPending, type StaffPreparationScope } from "./staff-preparation-client";
import { StaffRequirementsEditor } from "./StaffRequirementsEditor";
import { PackagePreparation } from "@/components/portal/applicationPackages/PackagePreparation";
import { PackageRecovery } from "@/components/portal/applicationPackages/PackageRecovery";
import { packageStrings } from "@/components/portal/applicationPackages/strings";
import { EDITOR_PENDING_EVENT, readEditorPending } from "@/lib/portal/application-requirements-editor-pending";

function subscribeHash(callback: () => void) {
  window.addEventListener("hashchange", callback);
  return () => window.removeEventListener("hashchange", callback);
}

function subscribeEditorPending(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(EDITOR_PENDING_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(EDITOR_PENDING_EVENT, callback);
  };
}

async function readProgramDocuments(scope: StaffPreparationScope, applicationId: string): Promise<StaffPreparationRead<ApplicationPackageReadiness>> {
  const result = await readStaffApplicationPackageReadinessAction(scope, { studentCaseId: scope.studentCaseId, applicationId });
  return result.ok ? { status: "ready", value: result.readiness }
    : { status: result.reason === "forbidden" ? "forbidden" : "unavailable" };
}

export function StaffPreparationPanel({ preparation, scope, canRead, canInitialize, canReview = false }: {
  preparation: CatalogPreparation;
  scope: StaffPreparationScope;
  canRead: boolean;
  canInitialize: boolean;
  canReview?: boolean;
}) {
  const [explicitOpen, setOpened] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const editorButton = useRef<HTMLButtonElement>(null);
  const [view, setView] = useState<StaffPreparationRead<ApplicationPackageReadiness> | null>(null);
  const [historyEpoch, setHistoryEpoch] = useState(0);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const { intent: retained, blocked: storageBlocked } = useStaffPending(scope, "requirements", preparation.applicationId);
  // A known pending intent must remain reachable after a lifecycle change.
  // The editor's fresh context governs new saves; the server authorizes replay.
  const hasEditorPending = useSyncExternalStore(subscribeEditorPending,
    () => !!readEditorPending({ ...scope, applicationId: preparation.applicationId }).intent,
    () => false);
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
    setHistoryEpoch(value => value + 1);
    setLoading(true);
    try {
      const result = await readProgramDocuments({ organizationId: scope.organizationId, membershipId: scope.membershipId,
        studentCaseId: scope.studentCaseId }, preparation.applicationId);
      if (request === epoch.current) setView(result);
    } catch {
      if (request === epoch.current) setView({ status: "unavailable" });
    } finally {
      if (request === epoch.current) setLoading(false);
    }
  }, [canRead, scope.organizationId, scope.membershipId, scope.studentCaseId, preparation.applicationId]);
  useEffect(() => {
    // Opening an anchor only reads. No initialization or replay happens on mount.
    if (!anchorOpen || !canRead) return;
    let active = true;
    const request = ++epoch.current;
    void readProgramDocuments({ organizationId: scope.organizationId, membershipId: scope.membershipId,
      studentCaseId: scope.studentCaseId }, preparation.applicationId)
      .then((result) => { if (active && request === epoch.current) setView(result); })
      .catch(() => { if (active && request === epoch.current) setView({ status: "unavailable" }); });
    return () => { active = false; };
  }, [anchorOpen, canRead, preparation.applicationId, scope.organizationId, scope.membershipId, scope.studentCaseId]);

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
  const documents = view?.status === "ready" ? view.value : null;
  const requirements = documents?.requirements ?? null;
  const documentScope = { ...scope, applicationId: preparation.applicationId };
  const documentStrings = getPortalStrings("programDocuments", "ru");
  return <section id={id} className="mt-4 scroll-mt-6 border-t border-border pt-3" aria-label="Подготовка по выбранной программе">
    <p className="text-sm text-fg-2">Набор: {intake.label}</p>
    <p className="mt-1 text-sm text-fg-3">{preparation.deadlineStateAtSelection === "needs_confirmation" ? "Срок набора нужно подтвердить" : "Срок сохранён при выборе"}{intake.applicationDeadline ? ` · ${intake.applicationDeadline}` : ""}</p>
    <button type="button" className={`${btnGhostCls} mt-3`} disabled={editorOpen} aria-expanded={opened} aria-controls={`${id}-documents`} onClick={() => {
      setOpened(!opened);
      if (!opened) void load();
      else if (anchorOpen) {
        window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}`);
        window.dispatchEvent(new HashChangeEvent("hashchange"));
      }
    }}>
      {opened ? "Скрыть подготовку" : "Открыть подготовку"}
    </button>
    <PackageRecovery scope={documentScope} audience="staff" strings={packageStrings("ru")} onSaved={() => void load()} />
    {opened ? <div id={`${id}-documents`} className="mt-4 space-y-3" aria-busy={loading || pending}>
      {editorOpen ? <StaffRequirementsEditor key={`${scope.organizationId}:${scope.membershipId}:${scope.studentCaseId}:${preparation.applicationId}`} scope={{ ...scope, applicationId: preparation.applicationId }} onSaved={() => { void load(); }} onClose={() => { setEditorOpen(false); requestAnimationFrame(() => editorButton.current?.focus()); }} /> : <>
      {canRead ? <PackagePreparation scope={documentScope} readiness={documents} loading={loading} audience="staff" strings={packageStrings("ru")} documentStrings={documentStrings} canReview={canReview} recovery={false} onSaved={() => void load()} epoch={historyEpoch} /> : null}
      <h4 className="font-semibold text-fg">Документы программы</h4>
      {requirements?.origin === "evo_starter" ? <p className="max-w-2xl text-sm leading-6 text-fg-2">Фото и паспорт — стартовые документы. Полный список для программы ещё нужно уточнить.</p> : null}
      {requirements?.configurationState === "confirmed" ? <p className="max-w-2xl text-sm leading-6 text-fg-2">Состав требований подтверждён сотрудником EVO. Файлы проверяются отдельно.</p> : null}
      {!canRead || view?.status === "forbidden" ? <p className="text-sm text-fg-2">Выбор программы сохранён. Нет доступа к чтению документов этого дела.</p> : <>
        {loading || !view ? <p role="status" className="text-sm text-fg-3">Загружаем текущие документы…</p> : null}
        {view && view.status !== "ready" ? <p role="alert" className="text-sm text-danger">Не удалось прочитать документы. Сохранённая подготовка остаётся доступной.</p> : null}
        {requirements?.state === "needs_configuration" ? <p role="status" className="text-sm leading-6 text-fg-2">Перечень или связи документов требуют настройки сотрудником. Существующий список не заменён.</p> : null}
        {requirements?.state === "uninitialized" ? <p className="text-sm text-fg-2">Стартовый список ещё не открыт.{!canInitialize ? " Для продолжения нужно право на подготовку документов и активное дело." : ""}</p> : null}
        {requirements?.items.length && requirements.revisionId && documents ? <ul className="divide-y divide-border">{requirements.items.map((item, index) => <li key={item.requirementItemId} className="py-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className="min-w-0 break-words font-medium text-fg">{item.label} <span className="text-sm font-normal text-fg-3">{item.required ? "Обязательно" : "Необязательно"}</span></p>
          </div>
          {item.definitionImpact === "changed" ? <p className="mt-2 max-w-2xl text-sm leading-6 text-fg-2">Требование изменилось. Проверьте, подходит ли текущий файл под новую инструкцию; прежнее решение по файлу не подтверждает это автоматически.</p> : null}
          {item.deadline ? <div className="mt-2 text-sm leading-6 text-fg-2">
            <p>Срок документа: <time dateTime={item.deadline.date}>{item.deadline.date.split("-").reverse().join(".")}</time>{item.deadline.time ? `, ${item.deadline.time}` : ""}{item.deadline.timezone ? ` (${item.deadline.timezone})` : ""}</p>
            <p>Срок проверен: <time dateTime={item.deadline.verifiedOn}>{item.deadline.verifiedOn.split("-").reverse().join(".")}</time></p>
            {item.deadline.sourceUrl ? <a className="inline-flex min-h-11 items-center underline underline-offset-4" href={item.deadline.sourceUrl} target="_blank" rel="noopener noreferrer">Источник срока (откроется в новой вкладке)</a> : null}
          </div> : null}
          {item.instructions ? <p className="mt-2 max-w-2xl text-sm text-fg-3">{item.instructions}</p> : null}
          <ProgramDocumentItem item={documents.documentItems[index]} scope={documentScope} target={{ studentCaseId: scope.studentCaseId,
            applicationId: preparation.applicationId, requirementsRevisionId: requirements.revisionId!,
            requirementItemId: item.requirementItemId, documentSlotId: item.documentSlotId }}
            audience="staff" strings={documentStrings} canReview={canReview} onSaved={() => void load()} historyEpoch={historyEpoch} />
        </li>)}</ul> : null}
        <ProgramDocumentRecovery scope={documentScope} audience="staff" strings={documentStrings}
          currentItemIds={documents?.documentItems.map(item => item.requirementItemId) ?? []}
          currentSubmissionIds={documents?.documentItems.flatMap(item => item.submission ? [item.submission.submissionId] : []) ?? []}
          onSaved={() => void load()} />
        <ProgramDocumentHistory key={historyEpoch} scope={documentScope} target={{ studentCaseId: scope.studentCaseId, applicationId: preparation.applicationId }}
          requirementItemId={null} audience="staff" strings={documentStrings} canReview={canReview} onSaved={() => void load()} />
        {storageBlocked ? <p role="alert" className="text-sm text-danger">Не удалось прочитать сохранённый запрос. Новое действие не отправляется.</p> : null}
        {canInitialize && (retained || requirements?.state === "uninitialized") ? <button type="button" disabled={pending || loading || storageBlocked} className={btnCls} onClick={() => void initialize()}>{pending ? "Подготавливаем…" : retained ? "Повторить сохранённый запрос" : "Продолжить подготовку"}</button> : null}
        <div className="flex flex-wrap gap-2"><button type="button" className={btnGhostCls} disabled={loading || pending} onClick={() => void load()}>Обновить документы</button><a href={docsHref} className={btnGhostCls}>Все документы дела</a></div>
        {canInitialize || hasEditorPending ? <button ref={editorButton} type="button" className={`${btnGhostCls} h-auto min-h-11 whitespace-normal py-2`} disabled={pending || !!retained || storageBlocked} onClick={() => setEditorOpen(true)}>{hasEditorPending ? "Проверить сохранение списка" : "Настроить список документов"}</button> : null}
        <p className="text-sm text-fg-3">{documentStrings.saveHint}</p>
      </>}
      {message ? <p role="alert" className="text-sm text-danger">{message}</p> : null}
      </>}
    </div> : null}
  </section>;
}
