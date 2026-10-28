"use client";

import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";

import { StaffSheetLockContext, type StaffSheetLockReport } from "@/components/v3/settings/staff-sheet-lock";

/** Тот же вопрос, что при закрытии панели с правкой у первой волны (`NextDrafts`). */
export const CLOSE_CONFIRM = "Есть несохранённые изменения. Закрыть без сохранения?";

/** Форма ещё правится: она в странице и в ней есть поле, которое можно менять (после сохранения набор полей отключён). */
const isEditing = (form: HTMLFormElement) => form.isConnected && form.querySelector("input:not([type=hidden]):not(:disabled), select:not(:disabled), textarea:not(:disabled)") !== null;

export type SheetGuard = Readonly<{
  /** Есть форма с незавершённым запросом: панель не закрывается. */
  locked: boolean;
  report: StaffSheetLockReport;
  touch: (form: HTMLFormElement) => void;
  /** Форма сохранена или сброшена: вводить больше нечего. */
  clean: () => void;
  /** Можно ли закрыть панель: нет незавершённого запроса, а несохранённую правку человек согласился отбросить. */
  allowClose: (extraLocked?: boolean) => boolean;
}>;

/**
 * Охрана панелей «Нового вида» с формами. Панель закрывается Esc и щелчком мимо, а форма внутри пропала бы вместе с введённым и с исходным
 * запросом: в прежнем виде формы стояли на странице и такого не случалось. Охрана держит панель открытой, пока запрос не завершён или итог
 * неизвестен (`useStaffSheetLock` в формах прежнего вида), и спрашивает, если в форме есть несохранённая правка. Правка = в форму вводили, и поля
 * ещё не отключены (сохранённая форма отключается; закрытая вручную исчезает со страницы).
 */
export function useSheetGuard(): SheetGuard {
  const held = useRef(new Set<object>());
  const touched = useRef(new Set<HTMLFormElement>());
  const [locked, setLocked] = useState(false);
  const report = useCallback<StaffSheetLockReport>((key, value) => {
    if (value) held.current.add(key); else held.current.delete(key);
    setLocked(held.current.size > 0);
  }, []);
  const touch = useCallback((form: HTMLFormElement) => { touched.current.add(form); }, []);
  const clean = useCallback(() => { touched.current.clear(); }, []);
  const allowClose = useCallback((extraLocked = false) => {
    if (extraLocked || held.current.size > 0) return false;
    if ([...touched.current].some(isEditing) && !window.confirm(CLOSE_CONFIRM)) return false;
    touched.current.clear();
    return true;
  }, []);
  return useMemo(() => ({ locked, report, touch, clean, allowClose }), [locked, report, touch, clean, allowClose]);
}

/** Тело панели под охраной: слушает ввод в формах и принимает сообщения форм прежнего вида; пока запрос не завершён, говорит, почему панель не закрывается. */
export function GuardedBody({ guard, children }: Readonly<{ guard: SheetGuard; children: ReactNode }>) {
  return (
    <StaffSheetLockContext.Provider value={guard.report}>
      <div onChange={(event) => { const form = event.target instanceof Element ? event.target.closest("form") : null; if (form) guard.touch(form); }}>
        {guard.locked ? <p role="status" className="mb-3 t-meta text-fg-3" data-testid="v3-sheet-locked">Пока результат запроса не проверен, панель не закрывается.</p> : null}
        {children}
      </div>
    </StaffSheetLockContext.Provider>
  );
}
