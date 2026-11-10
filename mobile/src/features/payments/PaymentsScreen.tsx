// Оплата: реквизиты «Как оплатить» (текст и QR), платежи студента с историей и чеки.
// Источник - одно чтение student_portal_payment_center_v1 (миграция 358); образец - PaymentsView.tsx (веб).
// Деньги в приложении не двигаются: оплата идёт вне приложения, студент прикладывает чек, засчитывает куратор.
import { Wallet } from "lucide-react-native";
import { useCallback, useState } from "react";
import { View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { minorToReceiptInput, type PaymentCenter, type PaymentEntry } from "@web/lib/portal/payment-center";

import { usePortalApi } from "@/api/PortalApi";
import { usePaymentCenter, useRefetchOnFocus } from "@/api/queries";
import { paymentCategoryLabel, paymentStatusPresentation } from "@/domain/payments-model";
import { formatPortalDeadline, formatPortalMoney } from "@/domain/presentation";
import { EntryRow } from "@/features/payments/EntryRow";
import { HowToPayCard } from "@/features/payments/HowToPayCard";
import { nativePaymentsIo, type PaymentsIo } from "@/features/payments/io";
import { ReceiptForm } from "@/features/payments/ReceiptForm";
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

/** Какая форма чека открыта: у платежа (`due:<id>`) или «без платежа» (`loose`). Одна на экран. */
type OpenForm = Readonly<{ target: string; obligationId: string | null; currency: string; amount: string; date?: string; nonce: number }>;

export function PaymentsScreen({ io = nativePaymentsIo }: { io?: PaymentsIo }) {
  const { m, t } = useLang();
  const { tokens } = useTheme();
  const { userKey } = usePortalApi();
  const client = useQueryClient();
  useRefetchOnFocus();
  const strings = t("admission");
  const center = usePaymentCenter();
  const [refreshing, setRefreshing] = useState(false);
  const [form, setForm] = useState<OpenForm | null>(null);
  const [sent, setSent] = useState(false);
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await client.refetchQueries({ queryKey: ["portal", userKey], type: "active" });
    } finally {
      setRefreshing(false);
    }
  }, [client, userKey]);

  const write = <Button variant="ghost" label={strings.paymentsWriteCurator} onPress={() => go("/messages/chat")} testID="payments-write-evo" />;

  const open = (next: Omit<OpenForm, "nonce">) => {
    setSent(false);
    setForm((current) => ({ ...next, nonce: (current?.nonce ?? 0) + 1 }));
  };
  const looseCurrency = (data: PaymentCenter) => data.dues[0]?.currency ?? data.unassigned[0]?.currency ?? "USD";
  const openLoose = (data: PaymentCenter, entry?: PaymentEntry) =>
    open({ target: "loose", obligationId: null, currency: entry?.currency ?? looseCurrency(data), amount: entry ? minorToReceiptInput(entry.amountMinor) : "", date: entry?.onDate });
  const renderForm = (target: string, fixedCurrency: string | null) =>
    form && form.target === target ? (
      <ReceiptForm
        key={form.nonce}
        io={io}
        idPrefix={target === "loose" ? "receipt-loose" : "receipt"}
        obligationId={form.obligationId}
        fixedCurrency={fixedCurrency}
        initialCurrency={form.currency}
        initialAmount={form.amount}
        initialDate={form.date}
        onSent={() => {
          setForm(null);
          setSent(true);
        }}
        onCancel={() => setForm(null)}
      />
    ) : null;

  const data = center.data;
  const isEmpty = data !== undefined && data.dues.length === 0 && data.unassigned.length === 0;

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

        {sent ? (
          <Card>
            <Text variant="body" tone="ok" bold accessibilityRole="alert" accessibilityLiveRegion="polite" testID="receipt-sent">
              {strings.receiptSent}
            </Text>
          </Card>
        ) : null}

        {data === undefined ? (
          center.status === "error" ? (
            <InlineAlert message={strings.paymentsLoadError} retryLabel={m("gate.retry")} onRetry={() => void center.refetch()} testID="payments-error" />
          ) : (
            <Card>
              <CardSkeleton label={`${strings.paymentsHeading}. ${m("state.loading")}`} lines={3} />
            </Card>
          )
        ) : (
          <>
            {data.details ? <HowToPayCard key={data.details.qrId ?? "text"} details={data.details} io={io} /> : null}

            {isEmpty ? (
              <Card>
                <EmptyBlock
                  icon={Wallet}
                  title={strings.paymentsEmptyTitle}
                  body={strings.paymentsEmptyBody}
                  action={
                    <View style={{ gap: 8, alignItems: "flex-start" }}>
                      {write}
                      {data.canUpload ? <Button variant="ghost" label={strings.receiptAttachLoose} onPress={() => openLoose(data)} testID="receipt-attach-loose" /> : null}
                    </View>
                  }
                />
                <View style={{ marginTop: 12 }}>{renderForm("loose", null)}</View>
              </Card>
            ) : null}

            {data.dues.length > 0 ? (
              <Card>
                <CardHead title={strings.paymentsHeading} />
                <View testID="payments-list">
                  {data.dues.map((payment, index) => {
                    const status = paymentStatusPresentation(payment, strings);
                    const category = paymentCategoryLabel(payment, strings);
                    const due = formatPortalDeadline(payment.dueAt);
                    const target = `due:${payment.obligationId}`;
                    return (
                      <View key={payment.obligationId} testID={`payment-${index}`} style={{ gap: 8, paddingVertical: 14, borderTopWidth: index === 0 ? 0 : 1, borderTopColor: tokens.line }}>
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

                        {payment.entries.length > 0 ? (
                          <View style={{ marginTop: 4 }} testID={`payment-history-${index}`}>
                            <Text variant="caption" tone="text2" bold accessibilityRole="header">
                              {strings.receiptHistoryHeading}
                            </Text>
                            {payment.entries.map((entry, entryIndex) => (
                              <EntryRow
                                key={entry.entryId}
                                entry={entry}
                                io={io}
                                first={entryIndex === 0}
                                testID={`payment-${index}-entry-${entryIndex}`}
                                onAttachAgain={data.canUpload ? () => open({ target, obligationId: payment.obligationId, currency: payment.currency, amount: minorToReceiptInput(entry.amountMinor), date: entry.onDate }) : null}
                              />
                            ))}
                          </View>
                        ) : null}

                        {renderForm(target, payment.currency)}
                        {data.canUpload && form?.target !== target ? (
                          <View style={{ flexDirection: "row" }}>
                            <Button
                              variant="ghost"
                              label={strings.receiptAttach}
                              accessibilityLabel={`${strings.receiptAttach}: ${payment.label}`}
                              onPress={() => open({ target, obligationId: payment.obligationId, currency: payment.currency, amount: payment.outstandingMinor > 0 ? minorToReceiptInput(payment.outstandingMinor) : "" })}
                              testID={`receipt-attach-${index}`}
                            />
                          </View>
                        ) : null}
                      </View>
                    );
                  })}
                </View>
              </Card>
            ) : null}

            {!isEmpty && (data.unassigned.length > 0 || data.canUpload) ? (
              <Card>
                <View testID="receipts-unassigned" style={{ gap: 8 }}>
                  <CardHead title={strings.receiptUnassignedHeading} />
                  <Text variant="secondary" tone="text2">
                    {strings.receiptUnassignedNote}
                  </Text>
                  {data.unassigned.map((entry, index) => (
                    <EntryRow key={entry.entryId} entry={entry} io={io} first={index === 0} testID={`unassigned-${index}`} onAttachAgain={data.canUpload ? () => openLoose(data, entry) : null} />
                  ))}
                  {renderForm("loose", null)}
                  {data.canUpload && form?.target !== "loose" ? (
                    <View style={{ flexDirection: "row" }}>
                      <Button variant="ghost" label={strings.receiptAttachLoose} onPress={() => openLoose(data)} testID="receipt-attach-loose" />
                    </View>
                  ) : null}
                </View>
              </Card>
            ) : null}

            {!isEmpty ? <View style={{ flexDirection: "row" }}>{write}</View> : null}
          </>
        )}
      </View>
    </Screen>
  );
}
