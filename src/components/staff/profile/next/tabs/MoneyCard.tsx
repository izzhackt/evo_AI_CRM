import { caseMoneyWords } from "@/lib/v3/wording";

import { CaseMoneyMenu } from "../../CaseMoney";
import { NamedCard } from "../NamedCard";

/**
 * Карточка «Оплата»: сводка, договор и график. «⋯» — меню листа (`CaseMoneySection`).
 * Дополнительные действия шапки (например «+ Платёж») стоят слева от меню.
 */
export function MoneyCard({ children, actions, className }: Readonly<{ children: React.ReactNode; actions?: React.ReactNode; className?: string }>) {
  return (
    <NamedCard title={caseMoneyWords.pay.title} testId="v3-case-agreement" className={className ? `@container ${className}` : "@container"} actions={<>{actions}<CaseMoneyMenu /></>}>
      {children}
    </NamedCard>
  );
}
