"use client";

import { useState } from "react";

/**
 * Панель записи, чьё открытие задаёт адрес (`?open=`): закрывается сразу, не дожидаясь ответа сервера на новый адрес.
 * `closed` держится, пока адрес ещё называет эту запись; когда адрес её отпустил, отметка снимается — «Назад» браузера
 * или повторное нажатие на ту же запись открывают панель снова.
 */
export function useDismissedSheet(openKey: string | null) {
  const [dismissed, setDismissed] = useState<string | null>(null);
  if (openKey === null && dismissed !== null) setDismissed(null);
  return {
    closed: openKey !== null && dismissed === openKey,
    dismiss: () => setDismissed(openKey),
    reset: () => setDismissed(null),
  };
}
