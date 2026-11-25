// «Прочитано» для ленты: запись замораживается на уведомление, id детерминированный
// (UUIDv5, как в вебе), повтор после сбоя шлёт тот же запрос. Сбои хранятся по студенту и уведомлению (`read-failures.ts`),
// поэтому не пропадают с экраном и не залипают после удачной записи на другом экране.
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import { notificationReadWrite, sendNotificationRead } from "@/api/inbox-api";
import { usePokePoll } from "@/api/PortalPoll";
import { usePortalApi } from "@/api/PortalApi";
import { notificationReadRequestId } from "@/domain/inbox-model";
import type { StudentPortalNotification } from "@/domain/portal-source";
import { applyReadOutcome, useReadFailures, type NotificationReadFailure } from "@/features/inbox/read-failures";
import type { FrozenWrite } from "@/lib/rpc";

export type { NotificationReadFailure };

export type NotificationReadOptions = Readonly<{
  /** Запись не удалась (после того, как плашка уже стоит): экран сообщает об этом читалке (`announce`), если он на виду. */
  onFailure?: (scope: NotificationReadFailure) => void;
}>;

export function useNotificationRead(options: NotificationReadOptions = {}) {
  const { transport, userKey, membershipId, organizationId, studentCaseId } = usePortalApi();
  const client = useQueryClient();
  const poke = usePokePoll();
  const writes = useRef(new Map<string, FrozenWrite>());
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  const { failed, all } = useReadFailures(userKey);
  // Колбэк экрана живёт в ссылке: запись, начатая с одной отрисовки, сообщает о сбое тому, что экран хочет сейчас.
  const onFailure = useRef(options.onFailure);
  useEffect(() => {
    onFailure.current = options.onFailure;
  });

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

  /**
   * Отметить одно или несколько уведомлений. `scope` - что видит студент, и его называет экран, а не число строк: нажатие на строку и
   * кнопка у строки - "one", «Отметить все» - "all", даже если непрочитанное одно (веб показывает markAllReadError именно по кнопке).
   * Записи идут по очереди и останавливаются на первом сбое. Возвращает, всё ли получилось; сбой остаётся в общем хранилище.
   */
  const markRead = useCallback(
    async (items: readonly Pick<StudentPortalNotification, "notificationId">[], scope: NotificationReadFailure): Promise<boolean> => {
      if (items.length === 0) return true;
      const ids = items.map((item) => item.notificationId);
      setPending((current) => new Set([...current, ...ids]));
      const succeeded: string[] = [];
      let ok = true;
      try {
        for (const item of items) {
          try {
            await sendNotificationRead(transport, writeFor(item.notificationId));
            writes.current.delete(item.notificationId);
            succeeded.push(item.notificationId);
          } catch {
            ok = false;
            break;
          }
        }
      } finally {
        setPending((current) => {
          const next = new Set(current);
          for (const id of ids) next.delete(id);
          return next;
        });
        applyReadOutcome(userKey, { scope, ok, succeeded, failed: ids.filter((id) => !succeeded.includes(id)) });
        void client.invalidateQueries({ queryKey: ["portal", userKey, "notifications"] });
        poke();
      }
      if (!ok) onFailure.current?.(scope);
      return ok;
    },
    [transport, writeFor, client, userKey, poke],
  );

  return {
    markRead,
    busy: pending.size > 0,
    isPending: (notificationId: string) => pending.has(notificationId),
    /** Номера уведомлений, запись которых не удалась (у каждого своя плашка с «Повторить»). */
    failedIds: failed,
    /** «Отметить все» не удалась. */
    allFailed: all,
  };
}
