// Сообщение читалке о новом входящем сообщении (веб MessagesThread: невидимый `role="status"` «Новое сообщение от {name}.»,
// PORT-6a, WCAG 4.1.3). Лента обновляется молча (опрос раз в 30 с), поэтому без этого читалка не узнала бы о новом. Первый
// показ ленты, своё сообщение и подгрузка более ранних не объявляются (`newIncomingAuthor`). Сообщение идёт в очередь за
// текущей речью (iPhone), чтобы не перебивать читаемую реплику.
import { useEffect, useRef } from "react";

import { newIncomingAuthor, type PortalCaseMessage } from "@/domain/inbox-model";
import type { formatPortalString } from "@/i18n";
import { announce } from "@/ui/a11y";

export function useIncomingNotice(messages: readonly PortalCaseMessage[], template: string, format: typeof formatPortalString): void {
  const shown = useRef<readonly PortalCaseMessage[] | null>(null);
  useEffect(() => {
    const before = shown.current;
    shown.current = messages;
    if (before === null) return;
    const author = newIncomingAuthor(before, messages);
    if (author !== null) announce(format(template, { name: author }), { queue: true });
  }, [messages, template, format]);
}
