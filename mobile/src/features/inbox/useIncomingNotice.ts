// Сообщение читалке о новом входящем сообщении (веб MessagesThread: невидимый `role="status"` «Новое сообщение от {name}.»,
// PORT-6a, WCAG 4.1.3). Лента обновляется молча (опрос раз в 30 с), поэтому без этого читалка не узнала бы о новом. Объявляется
// только то, что пришло, пока студент смотрит на беседу:
// - экран не виден (беседа осталась под другой вкладкой или приложение в фоне): ничего не говорим, чтобы не говорить поверх
//   чужого экрана; что пришло за это время, студент увидит, вернувшись, поэтому прежняя граница сдвигается молча;
// - данные при открытии беседы (из кэша «Входящих», который мог устареть, и первое свежее чтение с сервера) - это то, что
//   студент видит на открывшемся экране, а не новое: сообщение, пришедшее, пока его не было, не объявляется;
// - первый показ ленты, своё сообщение и подгрузка более ранних не объявляются (`newIncomingAuthor`).
// Сообщение идёт в очередь за текущей речью (iPhone), чтобы не перебивать читаемую реплику.
import { useEffect, useRef } from "react";

import { newIncomingAuthor, type PortalCaseMessage } from "@/domain/inbox-model";
import type { formatPortalString } from "@/i18n";
import { announce } from "@/ui/a11y";

export type IncomingNoticeGate = Readonly<{
  /** Беседа на экране и приложение на переднем плане (`useScreenVisible`). */
  visible: boolean;
  /** Открыли с устаревшим кэшем и свежего чтения с сервера ещё нет: показанное - это ещё не итог. */
  awaitingFresh: boolean;
}>;

export function useIncomingNotice(messages: readonly PortalCaseMessage[], template: string, format: typeof formatPortalString, gate: IncomingNoticeGate): void {
  const shown = useRef<readonly PortalCaseMessage[]>([]);
  // Первый проход (и проход, в котором пришло первое свежее чтение) только запоминает, что показано.
  const baselinePending = useRef(true);
  const { visible, awaitingFresh } = gate;
  useEffect(() => {
    const before = shown.current;
    shown.current = messages;
    if (!visible || baselinePending.current) {
      // Базовый проход закончится на первом чтении, пришедшем не позже открытия беседы (свежий кэш) или после него (устаревший).
      if (visible) baselinePending.current = awaitingFresh;
      return;
    }
    const author = newIncomingAuthor(before, messages);
    if (author !== null) announce(format(template, { name: author }), { queue: true });
  }, [messages, template, format, visible, awaitingFresh]);
}
