import { forwardRef } from "react";

import { Icon } from "@/components/icons";
import { ClosedLine } from "@/components/v3/closure/Closure";
import type { LeadClosureReceipt } from "@/lib/platform-closure-contract";
import { closureWords } from "@/lib/v3/wording";

export type ClosedNotice = Readonly<{ name: string; receipt: LeadClosureReceipt; reopened: boolean }>;

/**
 * Строка над доской после «Закрыть лид»: называет лида и даёт настоящий «Вернуть в работу» (обратная команда 246). Живёт до «Скрыть»
 * или следующего закрытия; фокус приходит сюда после закрытия и возврата, чтобы читалка прочла строку целиком.
 */
export const PipelineClosedNotice = forwardRef<HTMLDivElement, Readonly<{
  notice: ClosedNotice;
  onDismiss: () => void;
  onReopened: () => void;
}>>(function PipelineClosedNotice({ notice, onDismiss, onReopened }, ref) {
  return (
    <div ref={ref} tabIndex={-1} data-testid="v3-pipeline-closed-notice"
      className="flex items-start gap-2 rounded-card border border-border bg-card ps-4 outline-none focus-visible:outline-2 focus-visible:outline-focus-ring">
      {notice.reopened ? (
        <p role="status" className="flex min-h-11 min-w-0 flex-1 items-center break-words t-body-compact text-ok">Лид «{notice.name}» снова в работе.</p>
      ) : (
        <ClosedLine
          key={`${notice.receipt.leadId}:${notice.receipt.changedAt}`}
          kind="lead"
          subject={<>Лид «{notice.name}»</>}
          subjectId={notice.receipt.leadId}
          expectedVersion={notice.receipt.workflowVersion}
          reasonKey={notice.receipt.reason}
          note={notice.receipt.note}
          closedAt={notice.receipt.changedAt}
          canReopen
          onReopened={onReopened}
          className="min-w-0 flex-1 pt-3"
        />
      )}
      <button type="button" onClick={onDismiss} aria-label={closureWords.dismiss} data-testid="v3-pipeline-closed-notice-dismiss"
        className="flex size-11 shrink-0 items-center justify-center rounded-nav text-fg-2 hover:bg-surface-2 hover:text-fg">
        <Icon name="x" size={20} />
      </button>
    </div>
  );
});
