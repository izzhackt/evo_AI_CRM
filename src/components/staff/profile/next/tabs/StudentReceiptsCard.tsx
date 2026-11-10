import type { StudentReceipt } from "@/lib/platform-student-receipts-contract";

import { StudentReceiptsReview } from "../../StudentReceiptsReview";
import { NamedCard } from "../NamedCard";

/** «Чеки на проверке» в карточке дела: чеки, которые студент приложил сам и которые ещё не стали оплатой. Нет чеков - нет карточки. */
export function StudentReceiptsCard({ receipts, today }: Readonly<{ receipts: readonly StudentReceipt[]; today: string }>) {
  if (receipts.length === 0) return null;
  return (
    <NamedCard title="Чеки на проверке" id="case-receipts" testId="v3-case-student-receipts" count={receipts.length} className="@container">
      <p className="pb-2 t-body-compact text-fg-2">Студент приложил чек. Пока вы его не приняли, деньги не засчитаны.</p>
      <StudentReceiptsReview receipts={receipts} showStudent={false} today={today} />
    </NamedCard>
  );
}
