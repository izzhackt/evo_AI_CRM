"use client";

import { createContext, useContext, useEffect, useState } from "react";

/**
 * Сообщение формы панели «Нового вида»: «мой запрос не завершён» (идёт или его итог неизвестен). Панель, что держит форму, закрывается, только
 * когда ни одна форма так не отвечает: иначе закрытие по Esc или щелчку мимо выбросило бы форму вместе с исходным запросом и его request_id
 * (повторная проверка ушла бы уже новым запросом). Без панели (прежний вид, форма на странице) контекста нет и хук ничего не делает.
 */
export type StaffSheetLockReport = (key: object, locked: boolean) => void;

export const StaffSheetLockContext = createContext<StaffSheetLockReport | null>(null);

export function useStaffSheetLock(locked: boolean): void {
  const report = useContext(StaffSheetLockContext);
  const [key] = useState(() => ({}));
  useEffect(() => {
    if (!report) return;
    report(key, locked);
    return () => report(key, false);
  }, [report, key, locked]);
}
