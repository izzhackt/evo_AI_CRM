import type { StudentCaseChecklistCounts } from "../../../lib/platform-student-case-queue-contract.ts";

/**
 * Одна строка сводки дела под «Что дальше» (решение владельца 06.11.2026): «Документы 0/21 · Оплата 50%».
 * Только из прочитанных чисел: нет права читать документы или оплату - части нет, а не «0». Подробности (полоса документов,
 * остаток, финансовый стоп) - в «Сведениях» «Обзора» и на вкладках «Документы» и «Деньги». Чистая функция, без React.
 */
export type CaseSummaryPart = Readonly<{ key: "documents" | "payment"; label: string; value: string }>;

export function caseSummaryParts(input: Readonly<{
  documents: StudentCaseChecklistCounts | null;
  documentsAwaitCurator: boolean;
  payment: Readonly<{ percent: number | null }> | null;
}>): readonly CaseSummaryPart[] {
  const parts: CaseSummaryPart[] = [];
  if (input.documentsAwaitCurator) {
    parts.push({ key: "documents", label: "Документы", value: "ждут куратора" });
  } else if (input.documents !== null) {
    parts.push({
      key: "documents",
      label: "Документы",
      value: input.documents.total === 0 ? "чек-лист не собран" : `${input.documents.approved}/${input.documents.total}`,
    });
  }
  if (input.payment !== null) {
    parts.push({
      key: "payment",
      label: "Оплата",
      value: input.payment.percent === null ? "плана платежей нет" : `${input.payment.percent}%`,
    });
  }
  return parts;
}
