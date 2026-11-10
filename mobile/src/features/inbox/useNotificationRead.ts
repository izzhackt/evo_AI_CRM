// «Прочитано» для ленты: запись замораживается на уведомление, id детерминированный
// (UUIDv5, как в вебе), повтор после сбоя шлёт тот же запрос.
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";

import { notificationReadWrite, sendNotificationRead } from "@/api/inbox-api";
import { usePokePoll } from "@/api/PortalPoll";
import { usePortalApi } from "@/api/PortalApi";
import { notificationReadRequestId } from "@/domain/inbox-model";
import type { StudentPortalNotification } from "@/domain/portal-source";
import { rpcErrorKey, type FrozenWrite } from "@/lib/rpc";

export function useNotificationRead() {
  const { transport, userKey, membershipId, organizationId, studentCaseId } = usePortalApi();
  const client = useQueryClient();
  const poke = usePokePoll();
  const writes = useRef(new Map<string, FrozenWrite>());
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<ReturnType<typeof rpcErrorKey> | null>(null);

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

  /** Отметить одно или несколько уведомлений. Возвращает, всё ли получилось. */
  const markRead = useCallback(
    async (items: readonly Pick<StudentPortalNotification, "notificationId">[]): Promise<boolean> => {
      setBusy(true);
      setErrorKey(null);
      let ok = true;
      try {
        for (const item of items) {
          try {
            await sendNotificationRead(transport, writeFor(item.notificationId));
            writes.current.delete(item.notificationId);
          } catch (error) {
            ok = false;
            setErrorKey(rpcErrorKey(error));
            break;
          }
        }
      } finally {
        setBusy(false);
        void client.invalidateQueries({ queryKey: ["portal", userKey, "notifications"] });
        poke();
      }
      return ok;
    },
    [transport, writeFor, client, userKey, poke],
  );

  return { markRead, busy, errorKey };
}
