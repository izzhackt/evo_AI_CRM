import { caseMoneyWords } from "@/lib/v3/wording";

import { CaseMoneyMenu } from "../../CaseMoney";
import { NamedCard } from "../NamedCard";

/**
 * Карточка сводки «Договор и оплата» в «Новом виде»: заголовок листа, справа «⋯» с панелями (меню держит лист
 * `CaseMoneySection nextUi`, кнопка только читает его состояние). Остальное - транши, оплаты, открытая панель - соседние карточки листа.
 */
export function MoneyCard({ children, className }: Readonly<{ children: React.ReactNode; className?: string }>) {
  return (
    <NamedCard title={caseMoneyWords.title} testId="v3-case-agreement" className={className ? `@container ${className}` : "@container"} actions={<CaseMoneyMenu />}>
      {children}
    </NamedCard>
  );
}
