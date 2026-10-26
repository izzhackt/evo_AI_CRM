"use client";

import Link from "next/link";
import { useRef, useState } from "react";

import type { Locale } from "@/lib/i18n-data";
import { formatPortalString, type PortalStrings } from "@/lib/portal/i18n";
import { cscaDayLabel, type CscaOptionId, type CscaReview, type CscaReviewReceipt } from "@/lib/portal/csca";
import { recordCscaReviewAction, type CscaActionError } from "@/lib/portal/csca-actions";

import { ItemCard } from "./ItemCard";

type Strings = PortalStrings<"csca">;

/**
 * «Ошибки» (контракт §8): задания банка со сроком сегодня по одному. Ответ
 * проверяет сервер и сразу двигает задание по ящикам 1, 3, 7, 14 дней;
 * неверный возвращает его на завтра. Повтор после сбоя тем же request_id.
 */
export function ReviewRunner({
  review,
  locale,
  strings,
  homeHref,
}: {
  review: CscaReview;
  locale: Locale;
  strings: Strings;
  homeHref: string;
}) {
  // Набор заданий сессии повторения фиксируется при открытии экрана.
  const [items] = useState(() => review.items);
  const [figures] = useState(() => review.figures);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<CscaOptionId | null>(null);
  const [receipts, setReceipts] = useState<Record<string, CscaReviewReceipt & { selected: CscaOptionId }>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<CscaActionError["code"] | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const pending = useRef<{ itemKey: string; selected: CscaOptionId; requestId: string } | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const verdict = useRef<HTMLParagraphElement>(null);
  const doneHeading = useRef<HTMLHeadingElement>(null);

  const total = items.length;
  const current = index < total ? items[index] : null;
  const receipt = current ? receipts[current.itemKey] : undefined;

  async function submit() {
    if (busy || !current || receipt) return;
    const request = (pending.current?.itemKey === current.itemKey ? pending.current : null) ?? (selected
      ? { itemKey: current.itemKey, selected, requestId: crypto.randomUUID() }
      : null);
    if (!request) return;
    pending.current = request;
    setBusy(true);
    setError(null);
    setAnnouncement("");
    try {
      const response = await recordCscaReviewAction(request);
      if (!response.ok) {
        if (response.code !== "unavailable") pending.current = null;
        setError(response.code);
        return;
      }
      pending.current = null;
      setReceipts((previous) => ({ ...previous, [request.itemKey]: { ...response.receipt, selected: request.selected } }));
      setSelected(null);
      setAnnouncement(response.receipt.correct ? strings.verdictCorrect : strings.verdictWrong);
      requestAnimationFrame(() => verdict.current?.focus());
    } catch {
      setError("unavailable");
    } finally {
      setBusy(false);
    }
  }

  function next() {
    setIndex(index + 1);
    setSelected(null);
    setError(null);
    setAnnouncement("");
    requestAnimationFrame(() => (index + 1 < total ? heading.current : doneHeading.current)?.focus());
  }

  const done = Object.keys(receipts).length;
  const correct = Object.values(receipts).filter((entry) => entry.correct).length;

  if (!current) {
    return (
      <section className="cs-summary" aria-labelledby="cs-review-done">
        <h2 ref={doneHeading} tabIndex={-1} id="cs-review-done" className="cs-summary-title">{strings.reviewDoneTitle}</h2>
        <p className="cs-summary-body">
          {formatPortalString(strings.reviewDoneBody, { correct: String(correct), total: String(done) })}
        </p>
        <div className="cs-summary-actions">
          <Link className="pt-btn" href={homeHref}>{strings.backToTopics}</Link>
        </div>
      </section>
    );
  }

  const errorText = error === "review_not_due"
    ? strings.reviewNotDue
    : error === "denied" ? strings.errorDenied
      : error === "unavailable" ? strings.errorUnavailable
        : error ? strings.errorInvalid : null;

  const outcome = receipt
    ? receipt.retired
      ? strings.reviewRetired
      : receipt.correct && receipt.dueOn
        ? formatPortalString(strings.reviewNextDue, { date: cscaDayLabel(receipt.dueOn, locale) })
        : strings.reviewTomorrow
    : null;

  return (
    <div className="cs-runner">
      <p className="cs-review-progress cs-num">
        {formatPortalString(strings.reviewProgress, { done: String(done), total: String(total) })}
      </p>
      <p className="pt-sr-only" role="status" aria-live="polite" aria-atomic="true">
        {busy ? strings.checking : announcement}
      </p>
      <ItemCard
        key={current.itemKey}
        item={current.item}
        figure={current.item.figureKey ? figures[current.item.figureKey] ?? null : null}
        locale={locale}
        strings={strings}
        counter={formatPortalString(strings.itemCounter, { n: String(index + 1), total: String(total) })}
        headingRef={heading}
        verdictRef={verdict}
        meta={<span className="cs-chip">{formatPortalString(strings.reviewBox, { n: String(receipt?.box ?? current.box) })}</span>}
        state={receipt
          ? { kind: "answered", selected: receipt.selected, correct: receipt.correct, explain: receipt.explain }
          : { kind: "open", selected, busy }}
        onSelect={(id) => {
          if (pending.current?.selected !== id) pending.current = null;
          setSelected(id);
        }}
        onSubmit={() => void submit()}
        footer={
          <>
            {outcome ? <p className="cs-review-outcome">{outcome}</p> : null}
            {errorText ? (
              <div role="alert" className="cs-alert">
                <p>{errorText}</p>
                {error === "unavailable" ? (
                  <button type="button" className="pt-btn-ghost" disabled={busy} onClick={() => void submit()}>{strings.retry}</button>
                ) : null}
              </div>
            ) : null}
            <div className="cs-item-actions">
              {receipt ? (
                <button type="button" className="pt-btn" onClick={next}>
                  {index + 1 < total ? strings.nextItem : strings.toSummary}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="pt-btn"
                    aria-disabled={busy || selected === null ? true : undefined}
                    onClick={() => {
                      if (!busy && selected) void submit();
                    }}
                  >
                    {busy ? strings.checking : strings.checkAnswer}
                  </button>
                  <span className={selected ? "cs-item-hint cs-item-hint-keys" : "cs-item-hint"}>{selected ? strings.keyboardHint : strings.chooseFirst}</span>
                </>
              )}
            </div>
          </>
        }
      />
    </div>
  );
}
