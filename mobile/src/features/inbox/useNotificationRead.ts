// «Прочитано» для ленты: запись замораживается на уведомление, id детерминированный
// (UUIDv5, как в вебе), повтор после сбоя шлёт тот же запрос.
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";

import { notificationReadWrite, sendNotificationRead } from "@/api/inbox-api";
import { usePokePoll } from "@/api/PortalPoll";
import { usePortalApi } from "@/api/PortalApi";
import { notificationReadRequestId } from "@/domain/inbox-model";
import type { StudentPortalNotification } from "@/domain/portal-source";
import type { FrozenWrite } from "@/lib/rpc";

/**
 * Что не получилось: одно уведомление или несколько («Отметить все»). Тексты у веба разные: markReadError и
 * markAllReadError (`PortalNotificationReadForm`, «Часть могла быть отмечена»), поэтому экран берёт их по этому виду.
 */
export type NotificationReadFailure = "one" | "all";

export function useNotificationRead() {
  const { transport, userKey, membershipId, organizationId, studentCaseId } = usePortalApi();
  const client = useQueryClient();
  const poke = usePokePoll();
  const writes = useRef(new Map<string, FrozenWrite>());
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  const [failure, setFailure] = useState<NotificationReadFailure | null>(null);

  const writeFor = useCallback(
    (notificationId: string) => {
      let write = writes.current.get(notificationId);
      if (!write) {
        const requestId = notificationReadRequestId({ authUserId: userKey, membershipId, organizationId, studentCaseId }, notificationId);
        write = notificationReadWrite(notificationId, requestId);
        writes.current.set(notificationId, write);
      }
      return write;
    },
    [userKey, membershipId, organizationId, studentCaseId],
  );

  /** Отметить одно или несколько уведомлений. Возвращает, всё ли получилось; ошибка остаётся в `failure`. */
  const markRead = useCallback(
    async (items: readonly Pick<StudentPortalNotification, "notificationId">[]): Promise<boolean> => {
      if (items.length === 0) return true;
      const ids = items.map((item) => item.notificationId);
      setPending((current) => new Set([...current, ...ids]));
      setFailure(null);
      let ok = true;
      try {
        for (const item of items) {
          try {
            await sendNotificationRead(transport, writeFor(item.notificationId));
            writes.current.delete(item.notificationId);
          } catch {
            ok = false;
            setFailure(items.length > 1 ? "all" : "one");
            break;
          }
        }
      } finally {
        setPending((current) => {
          const next = new Set(current);
          for (const id of ids) next.delete(id);
          return next;
        });
        void client.invalidateQueries({ queryKey: ["portal", userKey, "notifications"] });
        poke();
      }
      return ok;
    },
    [transport, writeFor, client, userKey, poke],
  );

  return { markRead, busy: pending.size > 0, isPending: (notificationId: string) => pending.has(notificationId), failure };
}
