"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { CaseClosureReceipt } from "@/lib/platform-closure-contract";
import type { CaseNextActionReceipt, StudentCaseQueueRow } from "@/lib/platform-student-case-queue-contract";

import { caseNextActionBand } from "../students/students-queue-view";

/**
 * Строки очереди и открытая запись панели. Сохранённый шаг сразу виден в строке (и встаёт в свою группу по тому же правилу
 * дня, что у SQL), пока не придёт новое чтение; «Завершить дело» / «Вернуть в работу» уводят дело из вида списка, а
 * панель остаётся на нём (`kept`) с новым состоянием. Логика та же, что у `StudentsQueueBody` прежнего вида.
 */
export function useStudentRows(rows: readonly StudentCaseQueueRow[], openKey: string | null, now: Date) {
  const router = useRouter();
  const [saved, setSaved] = useState<StudentCaseQueueRow | null>(null);
  const [seenRows, setSeenRows] = useState(rows);
  const [kept, setKept] = useState<StudentCaseQueueRow | null>(rows.find((row) => row.studentCaseId === openKey) ?? null);
  if (seenRows !== rows) {
    setSeenRows(rows);
    const fresh = rows.find((row) => row.studentCaseId === openKey) ?? null;
    setKept(fresh ?? (saved?.studentCaseId === openKey ? saved : kept?.studentCaseId === openKey ? kept : null));
    setSaved(null);
  }
  const shown = saved ? rows.map((row) => row.studentCaseId === saved.studentCaseId ? saved : row) : rows;
  const open = openKey === null ? null : shown.find((row) => row.studentCaseId === openKey) ?? (kept?.studentCaseId === openKey ? kept : null);

  const baseOf = (id: string) => (saved?.studentCaseId === id ? saved : null) ?? rows.find((row) => row.studentCaseId === id) ?? (kept?.studentCaseId === id ? kept : null);
  const apply = (id: string, change: (base: StudentCaseQueueRow) => StudentCaseQueueRow) => {
    const base = baseOf(id);
    if (!base) { router.refresh(); return; }
    const next = change(base);
    setSaved(next);
    setKept(next);
    router.refresh();
  };
  return {
    shown,
    open,
    /** Пока сохранённая строка не пришла с сервера, числа групп скрыты: строка уже перешла в другую группу, а числа старые. */
    pendingRefresh: saved !== null,
    onSaved: (receipt: CaseNextActionReceipt) => apply(receipt.studentCaseId, (base) => ({
      ...base, nextAction: receipt.nextAction, nextActionDueOn: receipt.nextActionDueOn, admissionsVersion: receipt.admissionsVersion,
      dueBand: caseNextActionBand(receipt.nextAction, receipt.nextActionDueOn, now),
    })),
    onClosureChanged: (receipt: CaseClosureReceipt) => apply(receipt.studentCaseId, (base) => ({ ...base, state: receipt.state, admissionsVersion: receipt.admissionsVersion })),
  };
}
