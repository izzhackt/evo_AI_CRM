// Чтения и запись «Консультации» как запросы кабинета: ключи под ["portal", userKey, ...], вытягивание вниз на «Профиле»
// обновляет их вместе с остальными, выход размонтирует кэш.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { randomUUID } from "expo-crypto";
import { useRef } from "react";
import type { ConsultationReceipt } from "@web/lib/portal/consultation";

import { usePortalApi } from "@/api/PortalApi";
import { consultationWrite, readConsultationHistory, sendConsultation } from "@/features/consultation/consultation-api";

const key = (userKey: string) => ["portal", userKey, "consultations"] as const;

/** Своя история запросов; `enabled: false` - когда открытый запрос уже известен странице (страница вуза). */
export function useConsultationHistory(enabled = true) {
  const { transport, userKey } = usePortalApi();
  return useQuery({ queryKey: key(userKey), queryFn: () => readConsultationHistory(transport), enabled });
}

/**
 * Отправка запроса. Идентификатор один на форму, пока запрос не принят (веб: `useState(() => crypto.randomUUID())`): повтор
 * после сбоя шлёт тот же id. После успеха идентификатор меняется: когда менеджер обработает запрос, следующий будет новым, а не
 * тем же (иначе база вернула бы старый обработанный).
 */
export function useRequestConsultation(institutionId: string | null) {
  const { transport, userKey } = usePortalApi();
  const client = useQueryClient();
  const requestId = useRef<string | null>(null);
  return useMutation<ConsultationReceipt, Error, string>({
    mutationFn: (note) => {
      requestId.current ??= randomUUID();
      return sendConsultation(transport, consultationWrite(requestId.current, institutionId, note));
    },
    onSuccess: (receipt) => {
      requestId.current = null;
      // Уже прочитанная история получает новый запрос сразу (экран не мигает «Записаться» между ответом и повторным чтением),
      // а затем читается заново: менеджер мог обработать прежние запросы. Непрочитанная (страница вуза) не трогается.
      client.setQueryData<readonly ConsultationReceipt[] | undefined>(key(userKey), (old) =>
        old === undefined ? undefined : [receipt, ...old.filter((item) => item.requestId !== receipt.requestId)].slice(0, 20),
      );
      void client.invalidateQueries({ queryKey: key(userKey) });
    },
  });
}
