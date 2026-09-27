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
 * щелчок мимо закрывают её, фокус возвращается на кнопку. Содержимое не
 * размонтируется при закрытии — набранное не теряется. После сохранения
 * страница перечитывается, форма встаёт на новую версию, итог — строкой вверху.
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
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const onToggle = (event: Event) => {
      if ((event as ToggleEvent).newState === "open") {
        element.querySelector<HTMLElement>("select, textarea, input:not([type=hidden])")?.focus();
      } else {
        setSaved(false);
      }
    };
    element.addEventListener("toggle", onToggle);
    return () => element.removeEventListener("toggle", onToggle);
  }, []);

  return (
    <div
      ref={ref}
      id={LEAD_STEP_DRAWER_ID}
      popover="auto"
      role="dialog"
      aria-labelledby={headingId}
      data-testid="v3-lead-step-drawer"
      className="fixed inset-y-0 end-0 start-auto m-0 h-dvh max-h-none w-full max-w-[26rem] overflow-y-auto border-0 border-s border-border bg-surface p-0 text-fg shadow-evo-lg"
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
        {saved ? <p role="status" className="t-body-compact mb-3 text-ok">Решение сохранено.</p> : null}
        <PipelineDecisionForm
          key={`${lead.leadId}:${lead.workflowVersion}`}
          lead={lead}
          stages={stages}
          ownerOptions={ownerOptions}
          ownerOptionsHaveMore={ownerOptionsHaveMore}
          actor={actor}
          actorMembershipId={actor.membershipId}
          requestId={requestId}
          onSaved={() => setSaved(true)}
        />
      </div>
    </div>
  );
}
