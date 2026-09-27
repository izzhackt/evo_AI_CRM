"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { CloseRecordMenu, MENU_ITEM } from "../closure/Closure";

/**
 * Раскрыть группу правки Lead 360 и показать её: «⋯ → Доступ к порталу» и
 * адрес с якорем группы (`#sale-conditions` из отчёта и вкладки «Договор и
 * оплата»). Группы — `<details name>`: открыта одна, браузер закрывает
 * соседнюю сам.
 */
export function openLeadGroup(id: string): boolean {
  const target = document.getElementById(id);
  const group = target?.closest<HTMLDetailsElement>("details[data-lead-group]");
  if (!group) return false;
  group.open = true;
  group.scrollIntoView({ block: "start" });
  group.querySelector<HTMLElement>("summary")?.focus({ preventScroll: true });
  return true;
}

/**
 * Свёрнутые группы правки Lead 360 (Э4). Сами группы рисует сервер; здесь
 * только одно поведение: адрес с якорем группы раскрывает её и при загрузке,
 * и при смене якоря.
 */
export function LeadEditGroups({ children }: Readonly<{ children: ReactNode }>) {
  useEffect(() => {
    const open = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (id) openLeadGroup(id);
    };
    open();
    window.addEventListener("hashchange", open);
    return () => window.removeEventListener("hashchange", open);
  }, []);
  return <div data-lead-groups="">{children}</div>;
}

/**
 * «⋯» Lead 360: «Доступ к порталу» раскрывает свою группу справа, «Закрыть
 * лид…» — прежнее окно закрытия (246). Переданный лид закрыть нельзя — пункт
 * недоступен и называет причину; без права закрытия его нет вовсе.
 */
export function LeadMoreMenu({
  leadId,
  name,
  expectedVersion,
  blockedReason,
  closable,
  portalGroupId,
  portalHref,
}: Readonly<{
  leadId: string;
  name: string;
  expectedVersion: string;
  blockedReason: string | null;
  closable: boolean;
  /** id группы «Доступ к порталу»; null — группы нет. */
  portalGroupId: string | null;
  /** «Обзор» с якорем группы: на других вкладках группы на странице нет — переход к ней. */
  portalHref: string;
}>) {
  const router = useRouter();
  return (
    <CloseRecordMenu
      kind="lead"
      subjectId={leadId}
      subjectName={name}
      expectedVersion={expectedVersion}
      blockedReason={blockedReason}
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
