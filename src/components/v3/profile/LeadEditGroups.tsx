"use client";

import { useEffect, type ReactNode } from "react";

import { CloseRecordMenu } from "../closure/Closure";

/**
 * Раскрыть группу правки и показать её: «⋯ → Доступ к порталу» дела и адрес с
 * якорем группы (`#sale-conditions` из отчёта и вкладки «Договор и оплата»,
 * `#portal-access`). Группы — `<details name>`: открыта одна, браузер
 * закрывает соседнюю сам.
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
 * «⋯» Lead 360: «Закрыть лид…» — прежнее окно закрытия (246). Переданный лид
 * закрыть нельзя — пункт недоступен и называет причину. Без права закрытия
 * меню нет вовсе (решает `leadWorkParts`). «Доступ к порталу» — своя группа в
 * «Данных лида», не пункт меню (Э8.4).
 */
export function LeadMoreMenu({
  leadId,
  name,
  expectedVersion,
  blockedReason,
}: Readonly<{
  leadId: string;
  name: string;
  expectedVersion: string;
  blockedReason: string | null;
}>) {
  return (
    <CloseRecordMenu
      kind="lead"
      subjectId={leadId}
      subjectName={name}
      expectedVersion={expectedVersion}
      blockedReason={blockedReason}
      triggerClassName="flex size-11 shrink-0 items-center justify-center rounded-ctl border border-control-edge bg-surface text-fg-2 hover:bg-surface-2 hover:text-fg"
    />
  );
}
