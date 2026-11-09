// «Удалить аккаунт» (веб: AccountDeletionPanel, iPhone: AccountDeletionSheet; Apple 5.1.1(v)). Действие
// необратимо, поэтому второй шаг подтверждения тут же: вопрос, последствия, «Да, удалить аккаунт» и «Отмена».
// Запрос не удаляет аккаунт сразу: срок обработки 30 дней, статус приходит с сервера и виден на другом устройстве.
import { useState } from "react";
import { View } from "react-native";
import { accountDeletionDate } from "@web/lib/account-deletion-contract";

import { useAccountDeletion, useRequestAccountDeletion } from "@/features/profile/use-profile";
import { useLang } from "@/i18n/LangProvider";
import { useSession } from "@/session/SessionProvider";
import { Button } from "@/ui/Button";
import { CardHead, CardSkeleton, InlineAlert } from "@/ui/CardParts";
import { Card } from "@/ui/Screen";
import { Text } from "@/ui/Text";

export function DeletionCard() {
  const { t, m, format } = useLang();
  const strings = t("accountDeletion");
  const { signOut } = useSession();
  const read = useAccountDeletion();
  const request = useRequestAccountDeletion();
  const [confirming, setConfirming] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const open = read.data;

  return (
    <Card>
      <CardHead title={strings.heading} />
      {read.data === undefined && read.isPending ? (
        <CardSkeleton label={`${strings.heading}. ${m("state.loading")}`} lines={2} />
      ) : read.data === undefined ? (
        <InlineAlert message={strings.unavailable} retryLabel={m("profile.retry")} onRetry={() => void read.refetch()} testID="deletion-unavailable" />
      ) : open ? (
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
          <Text variant="secondary" tone="text2">
            {strings.keptNote}
          </Text>
          <Text variant="secondary" tone="text2">
            {m("profile.deleteSignOutHint")}
          </Text>
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
      ) : (
        <View style={{ gap: 12 }} testID="deletion-panel">
          <Text variant="body">{strings.description}</Text>
          <Text variant="secondary" tone="text2">
            {strings.keptNote}
          </Text>
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
      )}
    </Card>
  );
}
