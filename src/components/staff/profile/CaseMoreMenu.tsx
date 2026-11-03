"use client";

import { useRouter } from "next/navigation";

import { CloseRecordMenu, MENU_ITEM } from "../closure/Closure";
import { openLeadGroup } from "./LeadEditGroups";

/**
 * «⋯» Student 360 (Э4), как у Lead 360: «Доступ к порталу» раскрывает свою
 * группу в «Сведениях» (на других вкладках группы на странице нет — переход
 * на «Обзор» с её якорем), «Завершить дело…» — прежнее окно закрытия (246),
 * пока дело в работе и сервер подсказал право. Ни того ни другого — «⋯» нет.
 */
export function CaseMoreMenu({
  studentCaseId,
  name,
  expectedVersion,
  closable,
  openTasks,
  portalGroupId,
  portalHref,
}: Readonly<{
  studentCaseId: string;
  name: string;
  /** Версия дела для закрытия (`admissions_version` чтения 246); пусто — закрыть нельзя. */
  expectedVersion: string;
  closable: boolean;
  /** Открытые задачи «Обзора» для окна закрытия; null — не прочитаны. */
  openTasks: number | null;
  /** id группы «Доступ к порталу»; null — группы нет. */
  portalGroupId: string | null;
  portalHref: string;
}>) {
  const router = useRouter();
  if (!closable && portalGroupId === null) return null;
  return (
    <CloseRecordMenu
      kind="case"
      subjectId={studentCaseId}
      subjectName={name}
      expectedVersion={expectedVersion}
      openTasks={openTasks}
      closable={closable}
      triggerClassName="flex size-11 shrink-0 items-center justify-center rounded-ctl border border-control-edge bg-surface text-fg-2 hover:bg-surface-2 hover:text-fg"
      items={portalGroupId ? (close) => (
        <button type="button" className={MENU_ITEM} onClick={() => { close(); if (!openLeadGroup(portalGroupId)) router.push(portalHref); }}>
          Доступ к порталу
        </button>
      ) : undefined}
    />
  );
}
