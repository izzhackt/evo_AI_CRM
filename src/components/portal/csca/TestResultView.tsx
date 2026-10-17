"use client";

import type { ReactNode, Ref } from "react";

import type { Locale } from "@/lib/i18n-data";
import { formatPortalString, type PortalStrings } from "@/lib/portal/i18n";
import type { CscaTestAttempt } from "@/lib/portal/csca";

import { ItemCard } from "./ItemCard";

type Strings = PortalStrings<"csca">;
type Title = { ru: string; ky: string; en: string };

export type TitleMaps = {
  topics: Record<string, Title>;
  sections: Record<number, Title>;
};

function Tally({
  label,
  labelEn,
  correct,
  total,
  strings,
}: {
  label: string;
  labelEn?: string;
  correct: number;
  total: number;
  strings: Strings;
}) {
  const ratio = total > 0 ? correct / total : 0;
  return (
    <li className="cs-tally">
      <span className="cs-tally-name">
        {label}
        {labelEn ? <span className="cs-tally-en" lang="en">{labelEn}</span> : null}
      </span>
      <span className="cs-tally-value cs-num">
        {formatPortalString(strings.tallyLabel, { correct: String(correct), total: String(total) })}
      </span>
      <span className="cs-tally-bar" aria-hidden="true">
        <span style={{ transform: `scaleX(${ratio})` }} />
      </span>
    </li>
  );
}

/**
 * Итог теста на время (контракт §7.4): «Верно N из M» с обязательной
 * подписью «оценка EVO, а не балл CSCA», без процентов-шкал и порогов;
 * разбивка по модулям программы и темам, темп против 75 с, затем разбор
 * каждого задания: выбранный и верный варианты, разбор всех вариантов,
 * решение по шагам. Неотвеченные задания в банк ошибок не попадают.
 */
export function TestResultView({
  attempt,
  locale,
  strings,
  titles,
  headingRef,
  actions,
}: {
  attempt: CscaTestAttempt;
  locale: Locale;
  strings: Strings;
  titles: TitleMaps;
  headingRef?: Ref<HTMLHeadingElement>;
  actions?: ReactNode;
}) {
  const result = attempt.result;
  if (!result) return null;
  const ky = locale === "ky";
  const reviewByKey = new Map((attempt.review ?? []).map((entry) => [entry.itemKey, entry]));
  const title = (entry: Title | undefined, fallback: string) => (entry ? (ky ? entry.ky : entry.ru) : fallback);

  return (
    <div className="cs-result-wrap">
      <section className="cs-result" aria-labelledby="cs-result-title">
        <div className="cs-result-head">
          <h2 ref={headingRef} tabIndex={-1} id="cs-result-title" className="cs-result-score">
            {formatPortalString(strings.resultScore, {
              correct: String(result.correctCount),
              total: String(result.itemsTotal),
            })}
          </h2>
          <p className="cs-result-caption">{strings.resultCaption}</p>
        </div>
        <dl className="cs-facts">
          <div>
            <dt>{strings.testsHistoryHow}</dt>
            <dd>{strings[`completion.${result.completion}`]}</dd>
          </div>
          <div>
            <dt>{strings.notAnswered}</dt>
            <dd className="cs-num">{result.unansweredCount}</dd>
          </div>
          <div>
            <dt>{strings.paceHeading}</dt>
            <dd>
              {result.pace.avgSeconds === null
                ? strings.resultPaceNone
                : formatPortalString(strings.resultPace, {
                  avg: String(result.pace.avgSeconds),
                  budget: String(result.pace.budgetSeconds),
                })}
            </dd>
          </div>
        </dl>
        <div className="cs-result-breakdown">
          <div>
            <h3 className="cs-block-title">{strings.bySectionHeading}</h3>
            <ul className="cs-tallies">
              {result.bySection.map((entry) => {
                const section = titles.sections[entry.section];
                return (
                  <Tally
                    key={entry.section}
                    label={`${formatPortalString(strings.sectionLabel, { n: String(entry.section) })}. ${title(section, "")}`}
                    correct={entry.correct}
                    total={entry.total}
                    strings={strings}
                  />
                );
              })}
            </ul>
          </div>
          <div>
            <h3 className="cs-block-title">{strings.byTopicHeading}</h3>
            <ul className="cs-tallies">
              {result.byTopic.map((entry) => (
                <Tally
                  key={entry.topicKey}
                  label={title(titles.topics[entry.topicKey], entry.topicKey)}
                  labelEn={titles.topics[entry.topicKey]?.en}
                  correct={entry.correct}
                  total={entry.total}
                  strings={strings}
                />
              ))}
            </ul>
          </div>
        </div>
        {actions ? <div className="cs-result-actions">{actions}</div> : null}
      </section>

      <section className="cs-review-list" aria-labelledby="cs-review-list-title">
        <h2 id="cs-review-list-title" className="cs-section-title">{strings.reviewListHeading}</h2>
        <p className="cs-section-lead">{strings.reviewListLead}</p>
        <ol className="cs-review-items">
          {attempt.items.map((item, itemIndex) => {
            const entry = reviewByKey.get(item.itemKey);
            if (!entry) return null;
            return (
              <li key={item.itemKey}>
                <ItemCard
                  item={item}
                  figure={item.figureKey ? attempt.figures[item.figureKey] ?? null : null}
                  locale={locale}
                  strings={strings}
                  headingLevel={3}
                  counter={formatPortalString(strings.itemCounter, {
                    n: String(itemIndex + 1),
                    total: String(attempt.items.length),
                  })}
                  meta={
                    <>
                      {entry.seconds !== null ? (
                        <span className="cs-num">{formatPortalString(strings.secondsSpent, { n: String(entry.seconds) })}</span>
                      ) : null}
                      {entry.flagged ? <span className="cs-chip">{strings.legendFlagged}</span> : null}
                    </>
                  }
                  state={{ kind: "answered", selected: entry.selected, correct: entry.correct, explain: entry.explain }}
                />
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
