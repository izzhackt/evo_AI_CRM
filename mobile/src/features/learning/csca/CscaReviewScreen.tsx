// «Ошибки»: повторение с интервалами 1/3/7/14 дней (контракт §8). До 20 заданий на сегодня;
// ответ финален, вердикт и разбор приходят в ответе. Запись замораживается на задание.
import { useRef, useState } from "react";
import { View } from "react-native";

import type { CscaOptionId, CscaReviewReceipt } from "@web/lib/portal/csca";

import { usePortalApi } from "@/api/PortalApi";
import { loadErrorKey } from "@/api/queries";
import { cscaFailure, reviewWrite, sendReview, type CscaFailure } from "@/features/learning/csca/api";
import { cscaOnLabelSafe } from "@/features/learning/csca/format";
import { ItemCard } from "@/features/learning/csca/ItemCard";
import { ReportSheet } from "@/features/learning/csca/ReportSheet";
import { useCscaReviewBank, useInvalidateCsca } from "@/features/learning/queries";
import { StackPage, SubHeader, useBack } from "@/features/learning/ui";
import { useLang } from "@/i18n/LangProvider";
import type { FrozenWrite } from "@/lib/rpc";
import { Button } from "@/ui/Button";
import { CardSkeleton, InlineAlert } from "@/ui/CardParts";
import { Card } from "@/ui/Screen";
import { Text } from "@/ui/Text";

export function CscaReviewScreen() {
  const { lang, m, t, format } = useLang();
  const back = useBack("/csca");
  const c = t("csca");
  const bank = useCscaReviewBank();
  const invalidate = useInvalidateCsca();
  const { transport } = usePortalApi();
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<CscaOptionId | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<CscaFailure | null>(null);
  const [receipts, setReceipts] = useState<Record<string, { selected: CscaOptionId; receipt: CscaReviewReceipt }>>({});
  const [reporting, setReporting] = useState<string | null>(null);
  const [retryable, setRetryable] = useState(false);
  const pending = useRef<{ itemKey: string; selected: CscaOptionId; write: FrozenWrite } | null>(null);
  const data = bank.data;
  const header = <SubHeader title={c.reviewTitle} onBack={back} backLabel={c.backToHome} testID="review-title" />;

  if (!data) {
    return (
      <StackPage header={header} testID="review-screen">
        {bank.status === "error" ? <InlineAlert message={m(loadErrorKey(bank.error))} retryLabel={m("gate.retry")} onRetry={() => void bank.refetch()} testID="review-load-error" /> : <CardSkeleton label={m("state.loading")} lines={3} />}
      </StackPage>
    );
  }
  const items = data.items;
  if (items.length === 0) {
    return (
      <StackPage header={header} testID="review-screen">
        <Text variant="secondary" tone="text2">
          {c.reviewLead}
        </Text>
        <Card>
          <Text variant="heading" testID="review-empty">
            {data.activeCount === 0 ? c.reviewEmptyTitle : c.reviewEmptyTitle}
          </Text>
          <Text variant="secondary" tone="text2">
            {data.activeCount === 0 ? c.reviewEmptyBankBody : data.nextDueOn ? format(c.reviewEmptyNext, { date: cscaOnLabelSafe(data.nextDueOn, lang), count: String(data.activeCount) }) : c.reviewNone}
          </Text>
        </Card>
      </StackPage>
    );
  }
  const done = Object.keys(receipts).length;
  const current = index < items.length ? items[index] : null;
  const result = current ? receipts[current.itemKey] : undefined;
  const correctCount = Object.values(receipts).filter((r) => r.receipt.correct).length;

  async function submit() {
    if (!current || busy || result) return;
    const choice = pending.current?.itemKey === current.itemKey ? pending.current.selected : selected;
    if (!choice) return;
    // Тот же выбор после сбоя: тот же замороженный запрос.
    if (!(pending.current?.itemKey === current.itemKey && pending.current.selected === choice)) {
      pending.current = { itemKey: current.itemKey, selected: choice, write: reviewWrite(current.itemKey, choice) };
    }
    setBusy(true);
    setError(null);
    try {
      const receipt = await sendReview(transport, pending.current.write);
      pending.current = null;
      setRetryable(false);
      setReceipts((prev) => ({ ...prev, [current.itemKey]: { selected: choice, receipt } }));
      setSelected(null);
      invalidate();
    } catch (e) {
      const code = cscaFailure(e);
      if (code !== "unavailable") pending.current = null;
      setRetryable(code === "unavailable");
      setError(code);
    } finally {
      setBusy(false);
    }
  }

  if (!current) {
    return (
      <StackPage header={header} testID="review-screen">
        <Card>
          <Text variant="heading" accessibilityRole="header" testID="review-done">
            {c.reviewDoneTitle}
          </Text>
          <Text variant="secondary" tone="text2">
            {format(c.reviewDoneBody, { correct: String(correctCount), total: String(items.length) })}
          </Text>
          <Button label={c.backToTopics} onPress={back} />
        </Card>
      </StackPage>
    );
  }
  const errorText = error === "review_not_due" ? c.reviewNotDue : error === "denied" ? c.errorDenied : error === "unavailable" ? c.errorUnavailable : error ? c.errorInvalid : null;
  return (
    <StackPage header={header} testID="review-screen">
      <Text variant="caption" tone="text2">
        {format(c.reviewProgress, { done: String(done), total: String(items.length) })} · {format(c.reviewBox, { n: String(current.box) })}
      </Text>
      <ItemCard
        key={current.itemKey}
        item={current.item}
        figure={current.item.figureKey ? data.figures[current.item.figureKey] ?? null : null}
        counter={format(c.itemCounter, { n: String(index + 1), total: String(items.length) })}
        state={result ? { kind: "answered", selected: result.selected, correct: result.receipt.correct, explain: result.receipt.explain } : { kind: "open", selected, busy }}
        onSelect={(id) => {
          if (pending.current && pending.current.selected !== id) pending.current = null;
          setSelected(id);
        }}
        onReport={() => setReporting(current.itemKey)}
        footer={
          <View style={{ gap: 8 }}>
            {result ? (
              <Text variant="secondary" tone="text2" testID="review-next-due">
                {result.receipt.retired ? c.reviewRetired : result.receipt.dueOn ? format(c.reviewNextDue, { date: cscaOnLabelSafe(result.receipt.dueOn, lang) }) : c.reviewTomorrow}
              </Text>
            ) : null}
            {errorText ? <InlineAlert message={errorText} testID="review-error" /> : null}
            {result ? (
              <Button label={index + 1 < items.length ? c.nextItem : c.toSummary} onPress={() => { setIndex((i) => i + 1); setError(null); }} testID="review-next" />
            ) : (
              <Button label={busy ? c.checking : c.checkAnswer} busy={busy} disabled={selected === null && !retryable} onPress={() => void submit()} testID="review-check" />
            )}
          </View>
        }
      />
      {reporting ? <ReportSheet itemKey={reporting} visible onClose={() => setReporting(null)} /> : null}
    </StackPage>
  );
}
