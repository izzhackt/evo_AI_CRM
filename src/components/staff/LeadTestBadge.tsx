import { leadTestWords } from "@/lib/v3/wording";

/** Метка «Тест» у тестового лида (миграция 385): в списках, на доске, в панели и в карточке лида. */
export function LeadTestBadge({ className = "" }: Readonly<{ className?: string }>) {
  return (
    <span
      title={leadTestWords.badgeTitle}
      data-testid="v3-lead-test-badge"
      className={`inline-flex shrink-0 items-center rounded-ctl border border-control-edge bg-surface-2 px-1.5 t-meta text-fg-2 ${className}`.trim()}
    >
      {leadTestWords.badge}
    </span>
  );
}
