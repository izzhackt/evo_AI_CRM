"use client";

import { useEffect, useId, useRef, useState } from "react";

import { Icon } from "@/components/icons";
import type { ActivePlatformActor } from "@/lib/platform-auth";
import type { PlatformSalesOwnerOption, PlatformSalesStage, PlatformSalesWorkflowLead } from "@/lib/platform-sales-contract";

import { PipelineDecisionForm } from "../PipelineDecisionForm";
import { LEAD_STEP_DRAWER_ID } from "./lead-work-view";

/**
 * «Что дальше» Lead 360 (Э4): та же форма решения, что в панели доски
 * (`PipelineDecisionForm` — этап, ответственный, следующее действие, срок,
 * причина; то же действие и `expected_version`), в выдвижной панели верхнего
 * слоя справа. Панель — popover: её открывают кнопки с `popoverTarget` в любом
 * месте страницы (главное действие у заголовка, «Изменить» в шапке), Esc и
 * щелчок мимо закрывают её, фокус возвращается на кнопку. Открытая панель
 * ставит фокус на «Следующее действие» (нет шага — на «Без следующего
 * действия»), а не на «Этап». Содержимое не размонтируется при закрытии —
 * набранное не теряется. После сохранения панель закрывается, фокус
 * возвращается на кнопку, открывшую её, а «Решение сохранено» говорит строка
 * состояния шапки; страница перечитывается, форма встаёт на новую версию.
 */
export function LeadStepDrawer({
  name,
  lead,
  stages,
  ownerOptions,
  ownerOptionsHaveMore,
  actor,
  requestId,
}: Readonly<{
  name: string;
  lead: PlatformSalesWorkflowLead;
  stages: readonly Readonly<{ key: PlatformSalesStage; title: string }>[];
  ownerOptions: readonly PlatformSalesOwnerOption[];
  ownerOptionsHaveMore: boolean;
  actor: ActivePlatformActor;
  requestId: string;
}>) {
  const headingId = useId();
  const ref = useRef<HTMLDivElement>(null);
  // Кнопка, открывшая панель: после сохранения фокус возвращается на неё
  // (Safari не ставит фокус на кнопку по щелчку — запоминаем сам щелчок).
  const invoker = useRef<HTMLElement | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const onClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>(`[popovertarget="${LEAD_STEP_DRAWER_ID}"]`) : null;
      if (target && !element.contains(target)) invoker.current = target;
    };
    const onToggle = (event: Event) => {
      if ((event as ToggleEvent).newState !== "open") return;
      setSaved(false);
      (element.querySelector<HTMLElement>('textarea[name="next_action_text"]')
        ?? element.querySelector<HTMLElement>('input[type="checkbox"]')
        ?? element.querySelector<HTMLElement>("select, textarea, input:not([type=hidden])"))?.focus();
    };
    document.addEventListener("click", onClick, true);
    element.addEventListener("toggle", onToggle);
    return () => {
      document.removeEventListener("click", onClick, true);
      element.removeEventListener("toggle", onToggle);
    };
  }, []);

  const closeSaved = () => {
    setSaved(true);
    const element = ref.current;
    if (element?.matches(":popover-open")) element.hidePopover();
    const back = invoker.current;
    if (back?.isConnected) back.focus();
  };

  return <>
    {/* Строка состояния шапки: в дереве всегда (живой регион), видна — после сохранения. */}
    <p role="status" aria-live="polite" className={saved ? "t-body-compact text-ok" : "sr-only"} data-testid="v3-lead-step-status">
      {saved ? "Решение сохранено." : null}
    </p>
    <div
      ref={ref}
      id={LEAD_STEP_DRAWER_ID}
      popover="auto"
      role="dialog"
      aria-labelledby={headingId}
      data-testid="v3-lead-step-drawer"
      className="fixed inset-y-0 end-0 start-auto m-0 h-dvh max-h-none w-full max-w-[var(--side-panel-width)] overflow-y-auto border-0 border-s border-border bg-surface p-0 text-fg shadow-evo-lg"
    >
      <div className="sticky top-0 z-10 flex min-h-14 items-center gap-2 border-b border-border bg-surface ps-4 pe-2">
        <h2 id={headingId} className="t-section min-w-0 flex-1 truncate text-fg" title={name}>{name}</h2>
        <button
          type="button"
          popoverTarget={LEAD_STEP_DRAWER_ID}
          popoverTargetAction="hide"
          aria-label="Закрыть"
          className="flex size-11 shrink-0 items-center justify-center rounded-nav text-fg-2 hover:bg-surface-2 hover:text-fg"
        >
          <Icon name="x" size={20} />
        </button>
      </div>
      <div className="p-4">
        <PipelineDecisionForm
          key={`${lead.leadId}:${lead.workflowVersion}`}
          lead={lead}
          stages={stages}
          ownerOptions={ownerOptions}
          ownerOptionsHaveMore={ownerOptionsHaveMore}
          actor={actor}
          actorMembershipId={actor.membershipId}
          requestId={requestId}
          onSaved={closeSaved}
        />
      </div>
    </div>
  </>;
}
