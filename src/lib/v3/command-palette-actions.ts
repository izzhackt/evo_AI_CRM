"use server";

import { listPlatformStudentCases } from "../platform-admissions";
import { requirePlatformStaffActor } from "../platform-guards";
import { listPlatformSalesLeads } from "../platform-sales";
import { searchCommandPalette, type PaletteReaders, type PaletteSearch } from "./command-palette.ts";

/**
 * Чтения Ctrl+K — существующие чтения страниц, без новой SQL: дела —
 * `staff_student_case_page` (то же, что у поиска дела в диалоге задачи),
 * лиды — `staff_sales_lead_page` (то же, что у доски продаж). Каждое
 * отбирает строки правами сотрудника на сервере; `searchCommandPalette`
 * решает, какие группы роли положены, и оставляет только дела с полным
 * доступом.
 */
const READERS: PaletteReaders = {
  async students(actor, query, limit) {
    const page = await listPlatformStudentCases(actor, { query, pageSize: limit });
    return {
      rows: page.rows.map((row) => row.access === "full"
        ? {
          access: "full" as const,
          studentCaseId: row.studentCase.studentCaseId,
          studentDisplayName: row.studentCase.studentDisplayName,
          targetCountry: row.studentCase.targetCountry,
          targetDegree: row.studentCase.targetDegree,
          state: row.studentCase.state,
        }
        : {
          access: "sales_summary" as const,
          studentCaseId: row.studentCase.studentCaseId,
          studentDisplayName: row.studentCase.studentDisplayName,
          targetCountry: row.studentCase.targetCountry,
          targetDegree: row.studentCase.targetDegree,
          state: row.studentCase.state,
        }),
      hasNext: page.hasNext,
    };
  },
  async leads(actor, query, limit) {
    const page = await listPlatformSalesLeads(actor, { query, pageSize: limit });
    return {
      rows: page.rows.map((row) => ({ leadId: row.leadId, clientDisplayName: row.clientDisplayName })),
      hasNext: page.hasNext,
    };
  },
};

export async function searchCommandPaletteAction(query: string): Promise<PaletteSearch> {
  const actor = await requirePlatformStaffActor();
  return searchCommandPalette(actor, query, READERS);
}
