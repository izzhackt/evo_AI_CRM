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
 * Отправка запроса. Идентификатор один на форму и на вуз, пока запрос не принят (веб: `useState(() => crypto.randomUUID())`):
 * повтор после сбоя шлёт тот же id. После успеха идентификатор меняется: когда менеджер обработает запрос, следующий будет новым,
 * а не тем же (иначе база вернула бы старый обработанный).
 *
 * Идентификатор привязан к вузу (рецензия #1568): база отвечает на уже виденный `p_request_id` прежней строкой и остальные
 * аргументы не читает (миграция 197). Если тот же экземпляр хука получил другой вуз после неудачной попытки, повтор с тем же id и
 * новым вузом был бы молча записан на старый вуз. Поэтому при смене вуза идентификатор новый.
 */
export function useRequestConsultation(institutionId: string | null) {
  const { transport, userKey } = usePortalApi();
  const client = useQueryClient();
  const attempt = useRef<{ institutionId: string | null; requestId: string } | null>(null);
  return useMutation<ConsultationReceipt, Error, string>({
    mutationFn: (note) => {
      if (attempt.current === null || attempt.current.institutionId !== institutionId) attempt.current = { institutionId, requestId: randomUUID() };
      return sendConsultation(transport, consultationWrite(attempt.current.requestId, institutionId, note));
    },
    onSuccess: (receipt) => {
      attempt.current = null;
      // Уже прочитанная история получает новый запрос сразу (экран не мигает «Записаться» между ответом и повторным чтением),
      // а затем читается заново: менеджер мог обработать прежние запросы. Непрочитанная (страница вуза) не трогается.
      client.setQueryData<readonly ConsultationReceipt[] | undefined>(key(userKey), (old) =>
        old === undefined ? undefined : [receipt, ...old.filter((item) => item.requestId !== receipt.requestId)].slice(0, 20),
      );
      void client.invalidateQueries({ queryKey: key(userKey) });
    },
  });
}
