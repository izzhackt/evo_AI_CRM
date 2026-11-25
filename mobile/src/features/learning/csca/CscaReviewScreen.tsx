// «Ошибки»: повторение с интервалами 1/3/7/14 дней (контракт §8). До 20 заданий на сегодня; ответ финален, вердикт и разбор
// приходят в ответе. Запись замораживается на задание. Устроен как на вебе (components/portal/csca/ReviewRunner.tsx и
// math/review/page.tsx): вводная об интервалах всегда над экраном, пустое состояние ведёт «К темам», набор заданий
// фиксируется при открытии экрана (перечитанный банк его не сдвигает), вердикт озвучивается читалке.
import { NotebookPen } from "lucide-react-native";
import { useRef, useState } from "react";
import { View } from "react-native";

import type { CscaOptionId, CscaReview, CscaReviewReceipt } from "@web/lib/portal/csca";

import { usePortalApi } from "@/api/PortalApi";
import { loadErrorKey } from "@/api/queries";
import { cscaFailure, reviewWrite, sendReview, type CscaFailure } from "@/features/learning/csca/api";
import { cscaOnLabelSafe } from "@/features/learning/csca/format";
import { ItemCard, verdictAnnouncement } from "@/features/learning/csca/ItemCard";
import { ReportSheet } from "@/features/learning/csca/ReportSheet";
import { CSCA_TOPICS_FALLBACK, openCscaTopics } from "@/features/learning/csca/routes";
import { useWarmMath } from "@/features/learning/math/useWarmMath";
import { useCscaReviewBank, useInvalidateCsca } from "@/features/learning/queries";
import { StackPage, SubHeader, useBack } from "@/features/learning/ui";
import { useLang } from "@/i18n/LangProvider";
import type { FrozenWrite } from "@/lib/rpc";
import { Button } from "@/ui/Button";
import { CardSkeleton, EmptyBlock, InlineAlert } from "@/ui/CardParts";
import { Card } from "@/ui/Screen";
import { announce } from "@/ui/a11y";
import { Text } from "@/ui/Text";

/** Что сказать после ответа: срок следующего повтора, «выучено» или «вернётся завтра» (веб `outcome`). */
export function reviewOutcome(receipt: CscaReviewReceipt, text: { retired: string; tomorrow: string; nextDue: (date: string) => string }): string {
  if (receipt.retired) return text.retired;
  return receipt.correct && receipt.dueOn ? text.nextDue(receipt.dueOn) : text.tomorrow;
}

export function CscaReviewScreen() {
  useWarmMath();
  const { m, t } = useLang();
  const back = useBack(CSCA_TOPICS_FALLBACK);
  const c = t("csca");
  const bank = useCscaReviewBank();
  // Набор заданий сессии повторения фиксируется при открытии экрана: перечитанный после ответа банк его не двигает.
  const [review, setReview] = useState<CscaReview | null>(null);
  if (review === null && bank.data) setReview(bank.data);
  const header = <SubHeader title={c.reviewTitle} onBack={back} backLabel={c.backToHome} testID="review-title" />;
  const lead = (
    <Text variant="secondary" tone="text2" testID="review-lead">
      {c.reviewLead}
    </Text>
  );

  if (!review) {
    return (
      <StackPage header={header} testID="review-screen">
        {lead}
        {bank.status === "error" ? <InlineAlert message={m(loadErrorKey(bank.error))} retryLabel={m("gate.retry")} onRetry={() => void bank.refetch()} testID="review-load-error" /> : <CardSkeleton label={m("state.loading")} lines={3} />}
      </StackPage>
    );
  }
  if (review.items.length === 0) {
    return (
      <StackPage header={header} testID="review-screen">
        {lead}
        <ReviewEmpty review={review} />
      </StackPage>
    );
  }
  return (
    <StackPage header={header} testID="review-screen">
      {lead}
      <ReviewRunner review={review} />
    </StackPage>
  );
}

function ReviewEmpty({ review }: { review: CscaReview }) {
  const { lang, t, format } = useLang();
  const c = t("csca");
  return (
    <Card>
      <EmptyBlock
        icon={NotebookPen}
        title={c.reviewEmptyTitle}
        body={review.activeCount > 0 && review.nextDueOn ? format(c.reviewEmptyNext, { date: cscaOnLabelSafe(review.nextDueOn, lang), count: String(review.activeCount) }) : c.reviewEmptyBankBody}
        action={<Button variant="ghost" label={c.backToTopics} onPress={openCscaTopics} testID="review-to-topics" />}
      />
    </Card>
  );
}

function ReviewRunner({ review }: { review: CscaReview }) {
  const { lang, m, t, format } = useLang();
  const c = t("csca");
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
  const items = review.items;
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
      announce(verdictAnnouncement(choice, receipt.correct, receipt.explain.correctOptionId, c, format));
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
      <Card>
        <Text variant="heading" accessibilityRole="header" testID="review-done">
          {c.reviewDoneTitle}
        </Text>
        <Text variant="secondary" tone="text2">
          {format(c.reviewDoneBody, { correct: String(correctCount), total: String(done) })}
        </Text>
        <Button label={c.backToTopics} onPress={openCscaTopics} testID="review-done-topics" />
      </Card>
    );
  }
  const errorText = error === "review_not_due" ? m("learn.reviewNotDue") : error === "denied" ? c.errorDenied : error === "unavailable" ? c.errorUnavailable : error ? m("learn.reviewRejected") : null;
  return (
    <>
      <Text variant="caption" tone="text2" testID="review-progress">
        {format(c.reviewProgress, { done: String(done), total: String(items.length) })} · {format(c.reviewBox, { n: String(result?.receipt.box ?? current.box) })}
      </Text>
      <ItemCard
        key={current.itemKey}
        item={current.item}
        figure={current.item.figureKey ? review.figures[current.item.figureKey] ?? null : null}
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
                {reviewOutcome(result.receipt, { retired: c.reviewRetired, tomorrow: c.reviewTomorrow, nextDue: (date) => format(c.reviewNextDue, { date: cscaOnLabelSafe(date, lang) }) })}
              </Text>
            ) : null}
            {errorText ? <InlineAlert message={errorText} retryLabel={error === "unavailable" ? c.retry : undefined} onRetry={error === "unavailable" ? () => void submit() : undefined} testID="review-error" /> : null}
            {result ? (
              <Button label={index + 1 < items.length ? c.nextItem : c.toSummary} onPress={() => { setIndex((i) => i + 1); setError(null); }} testID="review-next" />
            ) : (
              <Button label={busy ? c.checking : c.checkAnswer} busy={busy} disabled={selected === null && !retryable} onPress={() => void submit()} testID="review-check" />
            )}
          </View>
        }
      />
      {reporting ? <ReportSheet itemKey={reporting} visible onClose={() => setReporting(null)} /> : null}
    </>
  );
}
