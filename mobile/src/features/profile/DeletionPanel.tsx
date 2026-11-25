// «Удалить аккаунт» (веб: AccountDeletionPanel, iPhone: AccountDeletionSheet; Apple 5.1.1(v)). Действие
// необратимо, поэтому второй шаг подтверждения тут же: вопрос, последствия, «Да, удалить аккаунт» и «Отмена».
// Запрос не удаляет аккаунт сразу: срок обработки 30 дней, статус приходит с сервера и виден на другом устройстве.
// Решение владельца 14.11.2026: поясняющих абзацев о сроке и хранении записей на рабочем экране нет (они остались
// только в анкете веба); панель стоит внутри секции «Конфиденциальность» «Профиля» без своей карточки и заголовка.
// Те же панель и действия стоят до кабинета: в мастере анкеты, на экране статуса анкеты и на экране «Доступ готовится»
// (веб: `look="apply"`, там абзацы `description` и `keptNote` остаются). Там нет кабинета, поэтому источник RPC
// передаётся явно (`source`), а не берётся из `PortalApi`.
import { useState } from "react";
import { View } from "react-native";
import { accountDeletionDate } from "@web/lib/account-deletion-contract";

import { useAccountDeletion, useRequestAccountDeletion, type DeletionSource } from "@/features/profile/use-profile";
import { useLang } from "@/i18n/LangProvider";
import { useSession } from "@/session/SessionProvider";
import { Button } from "@/ui/Button";
import { CardSkeleton, InlineAlert } from "@/ui/CardParts";
import { Text } from "@/ui/Text";

/** `portal`: рабочий экран кабинета без пояснений; `apply`: анкета, статус и ожидание (веб: `look="apply"`) с абзацами `description` и `keptNote`. */
export type DeletionLook = "portal" | "apply";

export function DeletionPanel({ source, look = "portal" }: { source?: DeletionSource; look?: DeletionLook } = {}) {
  const { t, m, format } = useLang();
  const strings = t("accountDeletion");
  const { signOut } = useSession();
  const read = useAccountDeletion(source);
  const request = useRequestAccountDeletion(source);
  const notes = look === "apply";
  const [confirming, setConfirming] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const open = read.data;

  if (read.data === undefined && read.isPending) {
    return <CardSkeleton label={`${strings.heading}. ${m("state.loading")}`} lines={1} />;
  }
  if (read.data === undefined) {
    return <InlineAlert message={strings.unavailable} retryLabel={m("profile.retry")} onRetry={() => void read.refetch()} testID="deletion-unavailable" />;
  }
  if (open) {
    return (
      <View style={{ gap: 12 }} testID="deletion-status" accessibilityLiveRegion="polite">
        {open.status === "processing" ? (
          <Text variant="body">{strings.processing}</Text>
        ) : (
          <>
            <Text variant="body" bold>
              {format(strings.requested, { date: accountDeletionDate(open.requestedAt) })}
            </Text>
            <Text variant="body">{format(strings.due, { date: accountDeletionDate(open.dueAt) })}</Text>
          </>
        )}
        {notes ? <Text variant="secondary" tone="text2" testID="deletion-kept-note">{strings.keptNote}</Text> : null}
        <Button
          label={m("profile.deleteSignOut")}
          variant="ghost"
          busy={leaving}
          onPress={() => {
            setLeaving(true);
            void signOut().finally(() => setLeaving(false));
          }}
          testID="deletion-sign-out"
        />
      </View>
    );
  }
  return (
    <View style={{ gap: 12 }} testID="deletion-panel">
      {notes ? (
        <>
          <Text variant="secondary" tone="text2" testID="deletion-description">{strings.description}</Text>
          <Text variant="secondary" tone="text2" testID="deletion-kept-note">{strings.keptNote}</Text>
        </>
      ) : null}
      {confirming ? (
        <View accessibilityRole="alert" style={{ gap: 12 }} testID="deletion-confirm">
          <Text variant="heading">{strings.confirmQuestion}</Text>
          <Text variant="secondary" tone="text2">
            {strings.confirmNote}
          </Text>
          <Button
            label={request.isPending ? strings.sending : strings.confirmYes}
            variant="dangerSolid"
            busy={request.isPending}
            onPress={() => request.mutate()}
            testID="deletion-confirm-yes"
          />
          <Button
            label={strings.cancel}
            variant="ghost"
            disabled={request.isPending}
            onPress={() => {
              setConfirming(false);
              request.reset();
            }}
            testID="deletion-cancel"
          />
          {request.isError ? <InlineAlert message={strings.error} testID="deletion-error" /> : null}
        </View>
      ) : (
        <Button label={strings.action} variant="danger" onPress={() => setConfirming(true)} testID="deletion-start" />
      )}
    </View>
  );
}
