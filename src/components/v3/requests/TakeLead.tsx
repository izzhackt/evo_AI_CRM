"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useActionState, useContext, useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";

import { updatePlatformSalesWorkflowAction, type PlatformSalesWorkflowActionState } from "@/lib/platform-sales-actions";
import type { RequestLeadTake } from "@/lib/requests-queue-contract";

import { QUEUE_QUIET_LINK } from "../queue/QueueStates";
import { QUEUE_SECONDARY } from "../queue/queue-buttons";

type Taken = Readonly<{ name: string; href: string }>;
type TakenState = Readonly<{ taken: Taken | null; announce: (taken: Taken) => void }>;
const TakenContext = createContext<TakenState | null>(null);

/**
 * Итог «Взять себе» над очередью. В «Ждут разбора» взятая строка после
 * обновления уходит из списка (и панель закрывается), поэтому итог живёт выше
 * строк и панели: провайдер обнимает очередь и панель, строка итога
 * (`TakeStatus`) стоит над строками — имя и ссылка на карточку лида, фокус
 * переходит на неё. Ключ провайдера — адрес очереди: при смене вкладки итог
 * не переезжает.
 */
export function TakeFeedback({ children }: Readonly<{ children: ReactNode }>) {
  const [taken, announce] = useState<Taken | null>(null);
  return <TakenContext.Provider value={{ taken, announce }}>{children}</TakenContext.Provider>;
}

export function TakeStatus() {
  const taken = useContext(TakenContext)?.taken ?? null;
  const line = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (taken) line.current?.focus({ preventScroll: true }); }, [taken]);
  return (
    <p ref={line} role="status" aria-live="polite" tabIndex={-1} data-testid="requests-take-status"
      className={taken ? "flex min-h-11 flex-wrap items-center gap-x-3 border-b border-border t-body-compact text-fg outline-none" : "sr-only"}>
      {taken ? <>
        <span>{taken.name} — теперь ваш лид.</span>
        <Link href={taken.href} className={QUEUE_QUIET_LINK}>Открыть карточку лида</Link>
      </> : null}
    </p>
  );
}

const MESSAGES: Readonly<Record<Exclude<PlatformSalesWorkflowActionState["status"], "idle" | "saved">, string>> = {
  invalid: "Лид уже не взять: его данные изменились. Обновите список.",
  forbidden: "У вашей роли нет права взять этот лид.",
  stale: "Лид уже изменён. Обновите список.",
  request_conflict: "Команда уже использована. Нажмите ещё раз.",
  unavailable: "Не подтверждено. Повторите.",
};

/**
 * «Взять себе» (Э3): ответственным становится текущий сотрудник через ту же
 * команду, что у формы решения доски (`updatePlatformSalesWorkflowAction` →
 * `mutate_sales_lead_workflow`): тот же набор полей, этап и следующее
 * действие лида не меняются, причина не нужна (ответственного не было).
 * Кнопка есть только там, где чтение сказало «можно взять». Изменённый
 * лид сервер не берёт — «Лид уже изменён».
 */
export function TakeLeadButton({
  leadId,
  take,
  actorMembershipId,
  requestId,
  personName,
  leadHref,
}: Readonly<{
  leadId: string;
  take: RequestLeadTake;
  actorMembershipId: string;
  requestId: string;
  personName: string;
  leadHref: string;
}>) {
  const router = useRouter();
  const announce = useContext(TakenContext)?.announce;
  const [result, action, pending] = useActionState(updatePlatformSalesWorkflowAction, {
    status: "idle", requestId, version: take.workflowVersion, changedAt: null,
  } satisfies PlatformSalesWorkflowActionState);
  const saved = result.status === "saved";
  const reportSaved = useEffectEvent(() => {
    announce?.({ name: personName, href: leadHref });
    router.refresh();
  });
  useEffect(() => { if (saved) reportSaved(); }, [saved, result.changedAt]);
  const clear = take.nextActionText === null;
  const message = result.status === "idle" || saved ? null : MESSAGES[result.status];
  return (
    <form action={action} className="relative z-10 flex flex-wrap items-center gap-x-2 gap-y-1" data-testid="requests-take">
      <input type="hidden" name="lead_id" value={leadId} />
      <input type="hidden" name="expected_version" value={take.workflowVersion} />
      <input type="hidden" name="request_id" value={result.requestId} />
      <input type="hidden" name="stage_key" value={take.stageKey} />
      <input type="hidden" name="current_owner_membership_id" value={actorMembershipId} />
      <input type="hidden" name="next_action_text" value={take.nextActionText ?? ""} />
      <input type="hidden" name="next_action_due_date" value={take.nextActionDueDate ?? ""} />
      <input type="hidden" name="clear_next_action" value={clear ? "true" : "false"} />
      <input type="hidden" name="reason" value="" />
      <button type="submit" disabled={pending || saved} aria-label={`Взять себе: ${personName}`} className={QUEUE_SECONDARY}>
        {pending ? "Берём…" : saved ? "Взято" : "Взять себе"}
      </button>
      {message ? (
        <p role="alert" className="basis-full t-meta text-warn">
          {message}
          {result.status === "stale" || result.status === "invalid" ? (
            <button type="button" onClick={() => router.refresh()} className="ms-1 inline-flex min-h-6 items-center underline underline-offset-2">Обновить</button>
          ) : null}
        </p>
      ) : null}
    </form>
  );
}
