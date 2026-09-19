"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";

import { btnCls, btnGhostCls, inputCls, labelCls } from "@/components/ui";
import {
  createPlatformUniversityApplicationAction,
  type PlatformUniversityApplicationActionState,
} from "@/lib/platform-admissions-actions";

import { ApplicationUniversitySelector } from "./ApplicationUniversitySelector";
import styles from "./ApplicationCreateDialog.module.css";
import {
  ApplicationCountryField,
  ApplicationDegreeField,
  PrimaryApplicationField,
  StateBanner,
  useCanonicalRefresh,
} from "./ProfileAdmissionsWorkspace";
import type { ProfileAdmissionsWorkspace } from "./types";

/**
 * OTH-4 («Куратор открывает дело → «Вузы и программы» → «Добавить вуз».
 * Небольшое окно поиска открывается поверх дела... программу указать сразу
 * либо позже... После добавления пользователь остаётся в карточке.»): a
 * small search dialog over the case, not the old bottom-of-page inline
 * `<details>`. `ApplicationUniversitySelector` is reused unchanged (same
 * catalog search + manual fallback); only its render location moved out of
 * ProfileAdmissionsWorkspace.tsx into this file.
 */
function ApplicationCreateForm({
  workspace,
  onSaved,
}: Readonly<{ workspace: ProfileAdmissionsWorkspace; onSaved: () => void }>) {
  const initialState: PlatformUniversityApplicationActionState = {
    status: "idle",
    requestId: workspace.requestIds.createApplication,
    universityApplicationId: null,
    version: null,
  };
  const [state, action, pending] = useActionState(
    createPlatformUniversityApplicationAction,
    initialState,
  );
  useCanonicalRefresh(state.status);
  const locked = pending || state.status === "saved" || state.status === "stale";

  useEffect(() => {
    if (state.status === "saved") onSaved();
  }, [state.status, onSaved]);

  return (
    <form action={action} className="space-y-3" aria-busy={pending} data-testid="v3-application-create">
      <input type="hidden" name="student_case_id" value={workspace.studentCaseId} />
      <input type="hidden" name="request_id" value={state.requestId} />
      <input type="hidden" name="expected_version" value="0" />
      {/* Unified workflow S4 (plan §11), kept by OTH-4: no submission-status
          editing here — a newly added university/program is simply "being
          considered" (docs/EVO_OTHER_FABLE_PLAN_2026-09-19.md §«Uni &
          knowledge base»: «Добавленный вуз означает «рассматриваем»»). The
          status column stays a required DB field, so a fixed default is
          still submitted, just never as a visible picker here — marking the
          actual submission is ApplicationStatusForm's separate job
          (ProfileAdmissionsWorkspace.tsx, «Отметить статус»). */}
      <input type="hidden" name="status" value="preparation" />
      <fieldset disabled={locked} className="grid gap-3">
        <ApplicationUniversitySelector key={workspace.studentCaseId} />
        <label>
          <span className={labelCls}>Программа</span>
          <input name="program_name" maxLength={300} className={inputCls} />
          <span className="mt-1 block text-xs text-fg-3">Можно указать позже.</span>
        </label>
        <PrimaryApplicationField defaultChecked={false} />
        <details>
          <summary className="cursor-pointer text-sm font-medium text-accent">
            Дополнительно
          </summary>
          <div className="mt-3 grid gap-3">
            <label>
              <span className={labelCls}>Дедлайн от университета</span>
              <input name="university_deadline_on" type="date" className={inputCls} />
            </label>
            <ApplicationCountryField />
            <ApplicationDegreeField />
            <label>
              <span className={labelCls}>Ссылка на подтверждение</span>
              <input name="evidence_reference" maxLength={1000} className={inputCls} />
            </label>
            <label>
              <span className={labelCls}>Заметка</span>
              <textarea name="note" rows={2} maxLength={1000} className={inputCls} />
            </label>
          </div>
        </details>
        <button type="submit" className={btnCls} disabled={locked}>
          {pending ? "Добавляем…" : "Добавить"}
        </button>
      </fieldset>
      <StateBanner status={state.status} />
    </form>
  );
}

function ApplicationCreateDialogBody({
  workspace,
  onClose,
}: Readonly<{ workspace: ProfileAdmissionsWorkspace; onClose: () => void }>) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const trigger = document.activeElement;
    dialog.showModal();

    return () => {
      dialog.close();
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      data-testid="v3-application-create-dialog"
    >
      <div className={styles.layout}>
        <header className={styles.header}>
          <h2 id={titleId}>Добавить вуз</h2>
          <button type="button" className={btnGhostCls} onClick={onClose}>
            Закрыть
          </button>
        </header>
        <div className={styles.body}>
          <ApplicationCreateForm workspace={workspace} onSaved={onClose} />
        </div>
      </div>
    </dialog>
  );
}

/** Launcher button + the small search dialog it opens (see file header). */
export function ApplicationCreateDialog({
  workspace,
}: Readonly<{ workspace: ProfileAdmissionsWorkspace }>) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className={btnGhostCls}
        aria-haspopup="dialog"
        data-testid="v3-application-create-launcher"
        onClick={(event) => {
          event.currentTarget.focus();
          setOpen(true);
        }}
      >
        Добавить вуз
      </button>
      {open ? (
        <ApplicationCreateDialogBody workspace={workspace} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}
