import "server-only";

import { listPlatformStudentCases } from "../platform-admissions";
import { listPlatformSalesLeads } from "../platform-sales";
import type { PaletteReaders } from "./command-palette.ts";

/**
 * Чтения поиска студентов и лидов — существующие чтения страниц, без новой SQL: дела — `staff_student_case_page`
 * (то же, что у поиска дела в диалоге задачи), лиды — `staff_sales_lead_page` (то же, что у доски продаж). Каждое
 * отбирает строки правами сотрудника на сервере. Их берут Ctrl+K (`command-palette-actions.ts`) и предупреждение о
 * дубле (`possible-duplicates.ts`).
 */
export const STUDENT_SEARCH_READERS: PaletteReaders = {
  async students(actor, query, limit) {
    const page = await listPlatformStudentCases(actor, { query, pageSize: limit });
    return {
      rows: page.rows.map((row) => ({
        access: row.access === "full" ? "full" as const : "sales_summary" as const,
        studentCaseId: row.studentCase.studentCaseId,
        studentDisplayName: row.studentCase.studentDisplayName,
        targetCountry: row.studentCase.targetCountry,
        targetDegree: row.studentCase.targetDegree,
        state: row.studentCase.state,
      })),
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
