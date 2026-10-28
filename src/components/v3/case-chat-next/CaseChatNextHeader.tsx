import Link from "next/link";
import { ArrowLeftIcon, FolderOpenIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Initials } from "@/components/v3/blocks/Initials";
import { ChatHeaderLink } from "@/components/v3/chats-next/ChatHeaderLink";
import { StageChip } from "@/components/v3/blocks/StatusChip";
import { AWAIT_CONTROL_ORDER, awaitTone, type CaseChatHeaderProps } from "@/components/v3/case-chat/CaseChatThread";
import { stagePhase } from "@/lib/v3/stages";
import { admissionsPipelineStage, caseChatAwaitChoice } from "@/lib/v3/wording";
import { cn } from "@/lib/utils";

/** Нажатая часть переключателя — в тоне состояния: «Нужен ответ» — предупреждение, остальное нейтрально (не красное). */
const PRESSED = {
  warn: "aria-pressed:border-warn aria-pressed:bg-warn-weak aria-pressed:text-warn",
  neutral: "aria-pressed:border-border-strong aria-pressed:bg-surface aria-pressed:text-fg",
} as const;

/**
 * Шапка переписки: с кем (имя, направление и этап доски), «Открыть дело» и видимый переключатель состояния из трёх
 * (прежняя команда `set_await`; null — состояние не прочитано, переключателя нет). Узко «К списку» — стрелка в строке имени.
 */
export function CaseChatNextHeader({ name, facts, caseId, listHref, awaitState, onSetAwait, awaitPending }: CaseChatHeaderProps) {
  const stage = facts?.stage ? admissionsPipelineStage(facts.stage) : null;
  const direction = facts?.direction ?? null;
  return (
    <div className="flex flex-col gap-1.5 border-b border-border px-3 py-2 @2xl:gap-2 @2xl:p-3" data-testid="case-chat-thread-header">
      <div className="flex items-start justify-between gap-2 @2xl:gap-3">
        <div className="flex min-w-0 items-start gap-1 @2xl:gap-2.5">
          <Button variant="ghost" size="icon" asChild className="-my-1 -ms-2 text-fg-2 @2xl:hidden">
            <Link href={listHref} scroll={false} aria-label="К списку" title="К списку"><ArrowLeftIcon aria-hidden="true" /></Link>
          </Button>
          {name ? <span className="mt-0.5 hidden shrink-0 @2xl:block"><Initials name={name} decorative /></span> : null}
          <div className="min-w-0">
            <h2 className="t-section break-words text-fg @max-2xl:line-clamp-2 @2xl:truncate">{name ?? "Переписка"}</h2>
            {direction || stage ? (
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 t-body-compact text-fg-2" data-testid="case-chat-case-facts">
                {direction ? <span>{direction}</span> : null}
                {direction && stage ? <span aria-hidden="true" className="text-fg-3">·</span> : null}
                {stage ? <StageChip label={stage} phase={stagePhase("admissions", facts?.stage)} /> : null}
              </p>
            ) : null}
          </div>
        </div>
        <ChatHeaderLink href={`/v3/profile?case=${caseId}`} label="Открыть дело" icon={FolderOpenIcon} />
      </div>
      {awaitState !== null ? (
        <div className="flex items-center gap-3">
          <span className="hidden t-label text-fg-3 @2xl:inline" aria-hidden="true">Состояние</span>
          <div role="group" aria-label="Состояние переписки" data-testid="case-chat-await-control"
            className="grid w-full grid-cols-3 gap-0.5 rounded-ctl border border-border bg-surface-2 p-0.5 @2xl:flex @2xl:w-fit">
            {AWAIT_CONTROL_ORDER.map((value) => (
              <Button key={value} variant="ghost" aria-pressed={awaitState === value} disabled={awaitPending} data-tone={awaitTone(value)}
                onClick={() => { if (value !== awaitState) onSetAwait(value); }}
                className={cn("h-11 min-w-0 whitespace-normal px-1.5 text-center aria-pressed:font-semibold @2xl:whitespace-nowrap @2xl:px-3", PRESSED[awaitTone(value) === "warn" ? "warn" : "neutral"])}>
                {caseChatAwaitChoice(value)}
              </Button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
