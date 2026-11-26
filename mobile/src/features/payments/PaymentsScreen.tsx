// Оплата: реквизиты «Как оплатить» (текст и QR), затем «Платежи» - по услугам, с суммами, полосой и одной таблицей, чек на
// самой строке. Источник - одно чтение student_portal_payment_center_v1 (миграция 358); образец - PaymentsView.tsx (веб, #1452),
// правила строк - общий payment-rows.ts. Деньги в приложении не двигаются: оплата идёт вне приложения, студент прикладывает
// чек, засчитывает куратор. Платёж вне графика - «Добавить платёж»: единственный ввод суммы, валюты и дня.
import { Wallet } from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import { View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import type { PaymentProofResult } from "@web/lib/portal/payment-proof";

import { usePortalApi } from "@/api/PortalApi";
import { usePaymentCenter, useRefetchOnFocus } from "@/api/queries";
import { buildPaymentsPage, howToPayAmount } from "@/domain/payments-model";
import { AddPaymentForm } from "@/features/payments/AddPaymentForm";
import { HowToPayCard } from "@/features/payments/HowToPayCard";
import { nativePaymentsIo, type PaymentsIo } from "@/features/payments/io";
import { PaymentTable, type AttachedProofs } from "@/features/payments/PaymentRow";
import { ServiceBlock } from "@/features/payments/ServiceBlock";
import { SlotButton } from "@/features/payments/SlotButton";
import { go } from "@/features/portal/navigation";
import { useLang } from "@/i18n/LangProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { CardHead, CardSkeleton, EmptyBlock, InlineAlert } from "@/ui/CardParts";
import { Card, Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";

export function PaymentsScreen({ io = nativePaymentsIo }: { io?: PaymentsIo }) {
  const { m, t } = useLang();
  const { tokens } = useTheme();
  const { userKey } = usePortalApi();
  const client = useQueryClient();
  useRefetchOnFocus();
  const strings = t("admission");
  const center = usePaymentCenter();
  const [refreshing, setRefreshing] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  // Идёт отправка из «Добавить платёж»: закрыть форму посреди отправки нельзя (студент не увидел бы ни успеха, ни отказа).
  const [addBusy, setAddBusy] = useState(false);
  const [attached, setAttached] = useState<AttachedProofs>(() => new Map());
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await client.refetchQueries({ queryKey: ["portal", userKey], type: "active" });
    } finally {
      setRefreshing(false);
    }
  }, [client, userKey]);
  const markAttached = useCallback((lineKey: string, result: PaymentProofResult | null) => {
    setAttached((current) => new Map(current).set(lineKey, result));
  }, []);

  const data = center.data;
  const page = useMemo(() => (data ? buildPaymentsPage(data, strings) : null), [data, strings]);
  const write = <Button variant="ghost" label={strings.paymentsWriteCurator} onPress={() => go("/messages/chat")} testID="payments-write-evo" />;

  return (
    <Screen topInset={false} tabBar onRefresh={() => void refresh()} refreshing={refreshing}>
      <View style={{ gap: 16 }} testID="payments-screen">
        <Text variant="display" accessibilityRole="header" maxFontSizeMultiplier={1.2} testID="title-payments">
          {strings.paymentsTitle}
        </Text>

        {data === undefined || page === null ? (
          center.status === "error" ? (
            <InlineAlert message={strings.paymentsLoadError} retryLabel={m("gate.retry")} onRetry={() => void center.refetch()} testID="payments-error" />
          ) : (
            <Card>
              <CardSkeleton label={`${strings.paymentsHeading}. ${m("state.loading")}`} lines={3} />
            </Card>
          )
        ) : (
          <>
            {data.details ? <HowToPayCard key={data.details.qrId ?? "text"} details={data.details} amount={howToPayAmount(data.dues)} io={io} /> : null}

            <Card>
              <View style={{ gap: 4 }}>
                <CardHead
                  title={strings.paymentsHeading}
                  action={data.canUpload ? <SlotButton look="primary" label={strings.receiptAddPayment} expanded={addOpen} disabled={addBusy} onPress={() => setAddOpen((open) => !open)} testID="payments-add" /> : null}
                />
                <Text variant="caption" tone="text2">
                  {strings.bishkekNote}
                </Text>
              </View>

              {addOpen && data.canUpload ? <AddPaymentForm io={io} currencies={page.currencies} defaultCurrency={page.defaultCurrency} onClose={() => setAddOpen(false)} onBusyChange={setAddBusy} /> : null}

              {page.empty ? (
                <EmptyBlock icon={Wallet} title={strings.paymentsEmptyTitle} body={strings.paymentsEmptyBody} action={write} />
              ) : (
                <View testID="payments-list" style={{ gap: 16 }}>
                  {page.services.map((service, index) => (
                    <ServiceBlock key={service.key} view={service} index={index} io={io} attached={attached} onAttached={markAttached} />
                  ))}
                  {page.added.length > 0 ? (
                    <View testID="payments-added" style={{ gap: 12, paddingTop: page.services.length === 0 ? 0 : 16, borderTopWidth: page.services.length === 0 ? 0 : 1, borderTopColor: tokens.line }}>
                      <View style={{ gap: 2 }}>
                        <Text variant="secondary" bold accessibilityRole="header">
                          {strings.receiptAddedHeading}
                        </Text>
                        <Text variant="caption" tone="text2">
                          {strings.receiptUnassignedNote}
                        </Text>
                      </View>
                      <PaymentTable lines={page.added} io={io} attached={attached} onAttached={markAttached} testIDPrefix="added" />
                    </View>
                  ) : null}
                </View>
              )}
            </Card>

            {!page.empty ? <View style={{ flexDirection: "row" }}>{write}</View> : null}
          </>
        )}
      </View>
    </Screen>
  );
}
