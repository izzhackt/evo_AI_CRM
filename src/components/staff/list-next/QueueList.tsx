"use client";

import { QueueKeyboard } from "../queue/QueueKeyboard";

/**
 * Список записей «Нового вида» с клавишами очереди: ↑/↓ и j/k по строкам, «/» — поиск (`useQueueKeyboard`). Стрелки
 * перехватываются только внутри `data-queue-list`: в панели и в меню они свои. Строки отмечают `data-queue-row`, их ссылки или
 * кнопки открытия — `data-queue-open`. Пока `keys` ложно (открытая панель держит фокус внутри себя), клавиши молчат.
 */
export function QueueList({ keys = true, children }: Readonly<{ keys?: boolean; children: React.ReactNode }>) {
  return (
    <div data-queue-list="" className="min-w-0">
      {keys ? <QueueKeyboard /> : null}
      {children}
    </div>
  );
}
