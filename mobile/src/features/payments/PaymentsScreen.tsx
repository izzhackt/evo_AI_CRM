// Оплата: начисления студента (student_portal_finance_v2), «Как оплатить» и «Написать EVO».
// Образец: PaymentsView.tsx (веб); целевое состояние по #1359: слово «Начисления»
// заменено на «Что нужно оплатить», добавлены блок «Как оплатить» и кнопка чата.
// Деньги в приложении не двигаются: оплата идёт вне приложения, здесь только сведения.
import { Wallet } from "lucide-react-native";
import { useCallback, useState } from "react";
import { View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";

import { usePortalApi } from "@/api/PortalApi";
import { loadErrorKey, usePayments, useRefetchOnFocus } from "@/api/queries";
import { hasHowToPay, paymentCategoryLabel, paymentStatusPresentation } from "@/domain/payments-model";
import { formatPortalDeadline, formatPortalMoney } from "@/domain/presentation";
import { go } from "@/features/portal/navigation";
import { useLang } from "@/i18n/LangProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { CardHead, CardSkeleton, EmptyBlock, InlineAlert } from "@/ui/CardParts";
import { Card, Screen } from "@/ui/Screen";
import { StatusPill } from "@/ui/StatusPill";
import { Text } from "@/ui/Text";

function Amount({ label, value, testID }: { label: string; value: string; testID: string }) {
  return (
    <View style={{ minWidth: 96, gap: 2 }}>
      <Text variant="caption" tone="text2">
        {label}
      </Text>
      <Text variant="data" bold testID={testID}>
        {value}
      </Text>
    </View>
  );
}

export function PaymentsScreen() {
  const { m, t } = useLang();
  const { tokens } = useTheme();
  const { userKey } = usePortalApi();
  const client = useQueryClient();
  useRefetchOnFocus();
  const strings = t("admission");
  const payments = usePayments();
  const [refreshing, setRefreshing] = useState(false);
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await client.refetchQueries({ queryKey: ["portal", userKey], type: "active" });
    } finally {
      setRefreshing(false);
    }
  }, [client, userKey]);
  const howToPay = m("payments.howBody");
  const write = <Button variant="ghost" label={m("payments.writeEvo")} accessibilityLabel={`${m("payments.writeEvo")}. ${m("payments.writeEvoHint")}`} onPress={() => go("/messages/chat")} testID="payments-write-evo" />;

  return (
    <Screen topInset={false} tabBar onRefresh={() => void refresh()} refreshing={refreshing}>
      <View style={{ gap: 16 }} testID="payments-screen">
        <View style={{ gap: 4 }}>
          <Text variant="display" accessibilityRole="header" maxFontSizeMultiplier={1.2} testID="title-payments">
            {strings.paymentsTitle}
          </Text>
          <Text variant="secondary" tone="text2">
            {strings.bishkekNote}
          </Text>
        </View>

        {payments.data === undefined ? (
          payments.status === "error" ? (
            <InlineAlert message={m(loadErrorKey(payments.error))} retryLabel={m("gate.retry")} onRetry={() => void payments.refetch()} testID="payments-error" />
          ) : (
            <Card>
              <CardSkeleton label={`${m("payments.heading")}. ${m("state.loading")}`} lines={3} />
            </Card>
          )
        ) : payments.data.length === 0 ? (
          <Card>
            <EmptyBlock icon={Wallet} title={strings.paymentsEmptyTitle} body={strings.paymentsEmptyBody} action={write} />
          </Card>
        ) : (
          <Card>
            <CardHead title={m("payments.heading")} />
            <View testID="payments-list">
              {payments.data.map((payment, index) => {
                const status = paymentStatusPresentation(payment, strings);
                const category = paymentCategoryLabel(payment, strings);
                const due = formatPortalDeadline(payment.dueAt);
                return (
                  <View key={`${payment.category}:${payment.dueAt}:${payment.label}:${index}`} testID={`payment-${index}`} style={{ gap: 8, paddingVertical: 14, borderTopWidth: index === 0 ? 0 : 1, borderTopColor: tokens.line }}>
                    <Text variant="body" bold accessibilityRole="header">
                      {payment.label}
                    </Text>
                    <StatusPill label={status.label} tone={status.tone} testID={`payment-status-${index}`} />
                    {category ? (
                      <Text variant="caption" tone="text2">
                        {category}
                      </Text>
                    ) : null}
                    {due ? (
                      <Text variant="caption" tone="text2">
                        {strings.dueTerm} {due}
                      </Text>
                    ) : null}
                    <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 16, rowGap: 8 }}>
                      <Amount label={strings.toPayTerm} value={formatPortalMoney(payment.amountMinor, payment.currency)} testID={`amount-${index}`} />
                      <Amount label={strings.paidTerm} value={formatPortalMoney(payment.paidMinor, payment.currency)} testID={`paid-${index}`} />
                      <Amount label={strings.outstandingTerm} value={formatPortalMoney(payment.outstandingMinor, payment.currency)} testID={`outstanding-${index}`} />
                      {payment.refundedMinor > 0 ? <Amount label={strings.refundedTerm} value={formatPortalMoney(payment.refundedMinor, payment.currency)} testID={`refunded-${index}`} /> : null}
                    </View>
                    {payment.nextAction ? (
                      <Text variant="secondary">
                        <Text variant="secondary" bold>
                          {strings.nextStepLabel}
                        </Text>{" "}
                        {payment.nextAction}
                      </Text>
                    ) : null}
                  </View>
                );
              })}
            </View>
          </Card>
        )}

        {/* TODO(owner #1359): текст «как оплатить» (реквизиты, способы) даёт владелец. Пока ключ payments.howBody пуст, блок не рисуется. */}
        {hasHowToPay(howToPay) ? (
          <Card>
            <CardHead title={m("payments.howTitle")} />
            <Text variant="body" testID="how-to-pay">
              {howToPay}
            </Text>
          </Card>
        ) : null}

        {payments.data && payments.data.length > 0 ? <View style={{ flexDirection: "row" }}>{write}</View> : null}
      </View>
    </Screen>
  );
}
