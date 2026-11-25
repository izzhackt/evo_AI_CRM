// «Удаление аккаунта» до кабинета: мастер анкеты вошедшего, экран статуса анкеты, «Доступ готовится» и «Анкета не
// отправилась». Веб: секция `#account-deletion` с заголовком и панелью `look="apply"` на /apply, /apply/status и
// /auth/account-pending (src/app/apply/page.tsx, apply/status/page.tsx, auth/account-pending/page.tsx).
// Apple 5.1.1(v): аккаунт, который можно создать в приложении, можно и удалить из приложения на любом шаге, не только
// после одобрения. Здесь нет `PortalApiProvider` (кабинет ещё не открыт), поэтому у секции свой кэш чтений и свой
// транспорт RPC платформы, а панель получает их явным `source`.
import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { createPortalQueryClient } from "@/api/PortalApi";
import { DeletionPanel } from "@/features/profile/DeletionPanel";
import { useLang } from "@/i18n/LangProvider";
import { getSupabase, platformTransport } from "@/lib/supabase";
import type { RpcTransport } from "@/lib/rpc";
import { Card } from "@/ui/Screen";
import { Text } from "@/ui/Text";

/** Ключ кэша секции: пользователь тут один (его сессия), а кэш живёт, пока открыт экран. */
const APPLICANT_KEY = "applicant";

/**
 * Секция «Удаление аккаунта». `transport` нужен тестам и экранам, у которых он уже есть; без него берётся настоящий
 * транспорт RPC платформы с сессией студента.
 */
export function ApplicantDeletionSection({ transport: given }: { transport?: RpcTransport } = {}) {
  const { t } = useLang();
  const strings = t("accountDeletion");
  const [client] = useState(() => {
    const created = createPortalQueryClient();
    // Итог записи после ухода с экрана никому не нужен: запись «Удалить аккаунт» не ждёт сборщика мусора пять минут
    // (иначе его таймер переживает экран, а в тестах Jest не выходит).
    created.setDefaultOptions({ ...created.getDefaultOptions(), mutations: { gcTime: 0 } });
    return created;
  });
  const transport = useMemo(() => given ?? platformTransport(getSupabase()), [given]);
  const source = useMemo(() => ({ transport, userKey: APPLICANT_KEY }), [transport]);
  // Кэш живёт, пока открыта секция; его таймеры не должны пережить выход. Отложенно: наблюдатели запроса отписываются
  // позже родительской очистки и заново ставят таймер сборки (так же устроен экран статуса).
  useEffect(
    () => () => {
      void Promise.resolve().then(() => client.clear());
    },
    [client],
  );
  return (
    <QueryClientProvider client={client}>
      <Card>
        <Text variant="heading" accessibilityRole="header" testID="applicant-deletion-heading">
          {strings.heading}
        </Text>
        <DeletionPanel source={source} look="apply" />
      </Card>
    </QueryClientProvider>
  );
}
