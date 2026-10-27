import { KeyFacts } from "@/components/kit/KeyFacts";
import type { ClosedLeadRow } from "@/lib/platform-closure-contract";
import { closureWords, leadStage } from "@/lib/v3/wording";

import { ClosedLine } from "../../../closure/Closure";
import { NamedCard } from "../NamedCard";

/**
 * Закрытый лид (`/v3/profile?id=…`, миграция 246) в «Новом виде»: одна карточка - «Лид закрыт», причина и дата, «Вернуть в работу»
 * (та же команда `ClosedLine`), под ними этап, ответственный и кто закрыл. Почему нет контактов и истории - за «?» карточки.
 * Детальное чтение 093 закрытого лида не отдаёт, поэтому данных ровно столько, сколько в строке «Закрытых» (`ClosedLeadRow`).
 */
export function ClosedLeadNext({ row, readOnly }: Readonly<{ row: ClosedLeadRow; readOnly: boolean }>) {
  const word = leadStage(row.stageKey);
  const stage = word ? word.charAt(0).toUpperCase() + word.slice(1) : null;
  const canReopen = row.canManage && !readOnly;
  return (
    <div className="grid grid-cols-1 gap-4" data-testid="v3-lead-closed" data-lead-id={row.leadId}>
      <NamedCard
        title="Лид закрыт"
        testId="v3-lead-closed-card"
        help={canReopen ? closureWords.lead.detailsAfterReopen : closureWords.lead.detailsOpenOnly}
      >
        <div className="grid grid-cols-1 gap-3">
          <ClosedLine
            kind="lead"
            subjectId={row.leadId}
            expectedVersion={row.workflowVersion}
            reasonKey={row.reason}
            note={row.note}
            closedAt={row.closedAt}
            canReopen={canReopen}
            showState={false}
          />
          <div className="border-t border-border pt-3">
            <KeyFacts
              columns={3}
              facts={[
                { label: "Этап", value: stage },
                { label: "Ответственный", value: row.ownerName ?? <span className="text-fg-3">Не назначен</span> },
                { label: "Закрыл", value: row.closedByName },
              ]}
            />
          </div>
        </div>
      </NamedCard>
    </div>
  );
}
