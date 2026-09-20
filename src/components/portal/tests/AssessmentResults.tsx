"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

import type { Locale } from "@/lib/i18n-data";
import { formatPortalString, getPortalStrings, type PortalStrings } from "@/lib/portal/i18n";
import type { AssessmentAttempt, AssessmentProfession, OrvisScale } from "@/lib/student-assessment-contract";

type TestsStrings = PortalStrings<"tests">;

/**
 * Результаты english36/orvis92 в «Атласе» (PORT-8c). Подписи интерфейса —
 * неймспейс tests (RU байт-в-байт прежний, KY полный); содержательный текст
 * (метаданные, разборы, профессии, ограничения) — контент read model со
 * своей локалью и здесь не переводится.
 */
function ProfessionCard({ profession, strings }: { profession: AssessmentProfession; strings: TestsStrings }) {
  return (
    <details className="pt-res-details">
      <summary className="pt-res-summary-line">{profession.title}</summary>
      <div className="pt-res-details-body">
        <p>{profession.summary}</p>
        <div>
          <h4 className="pt-res-term">{strings.professionDay}</h4>
          <ul className="pt-res-bullets">{profession.tasks.map((item) => <li key={item}>{item}</li>)}</ul>
        </div>
        <p><strong className="pt-res-term">{strings.professionSkills}</strong>{profession.skills.join(" · ")}</p>
        <p><strong className="pt-res-term">{strings.professionStudy}</strong>{profession.studyDirections.join(" · ")}</p>
        {profession.careerPath?.length ? (
          <p><strong className="pt-res-term">{strings.professionPath}</strong>{profession.careerPath.join(" → ")}</p>
        ) : null}
        <p className="pt-res-try"><strong className="pt-res-term">{strings.professionTry}</strong>{profession.tryActivity}</p>
        <p className="pt-res-note">{profession.editorialNote}</p>
        <p className="pt-res-note">
          {strings.professionSourceLead}{" "}
          <a className="pt-res-source-link" href={profession.source.url} target="_blank" rel="noopener noreferrer">
            {formatPortalString(strings.professionSourceProfile, { id: profession.source.occupationId })}
          </a>
          , {profession.source.version};{" "}
          <a className="pt-res-source-link" href={profession.source.licenseUrl} target="_blank" rel="noopener noreferrer">
            {profession.source.license}
          </a>
          . {formatPortalString(strings.professionSourceChecked, { date: profession.source.retrievedOn })}
        </p>
      </div>
    </details>
  );
}

export function AssessmentResults({ attempt, locale }: { attempt: AssessmentAttempt; locale: Locale }) {
  const strings = getPortalStrings("tests", locale);
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => { title.current?.focus(); }, []);
  const result = attempt.result;
  if (!result) return null;
  const english = result.english;
  const orvis = result.orvis;
  const scales = orvis ? [...orvis.scales].sort((a, b) => b.mean - a.mean) : [];
  const preferred = result.metadata.professions?.filter((p) => p.scaleIds.some((s) => orvis?.topScales.includes(s))) ?? [];
  const other = result.metadata.professions?.filter((p) => !preferred.includes(p)) ?? [];
  const knownTopic = (topic: string) =>
    topic === "grammar" || topic === "vocabulary" || topic === "reading" ? strings[`topic.${topic}`] : null;
  const topicLabel = (topic: string) => knownTopic(topic) ?? topic;

  return (
    <div className="pt-res" data-testid="assessment-results">
      <section className="pt-res-card">
        <p className="pt-res-kicker">{formatPortalString(strings.resultCompleted, { version: result.version })}</p>
        <h2 ref={title} tabIndex={-1} className="pt-res-title">
          {english
            ? formatPortalString(strings.resultScore, { correct: String(english.correctCount), total: String(english.totalCount) })
            : strings.resultCareerTitle}
        </h2>
        {english?.band ? (
          <p className="pt-res-band">{result.metadata.bands?.find((b) => b.id === english.band)?.label ?? strings.resultBandFallback}</p>
        ) : null}
        <p className="pt-res-lead">{english ? strings.resultEnglishLead : strings.resultCareerLead}</p>
        <p className="pt-res-note">{strings.resultSavedNote}</p>
      </section>

      {english ? (
        <>
          <section aria-labelledby="english-topics">
            <h2 id="english-topics" className="pt-section-title">{strings.topicsHeading}</h2>
            <div className="pt-res-list">
              {english.topics.map((topic) => (
                <div key={topic.topic} className="pt-res-row">
                  <div className="pt-res-row-head">
                    <h3 className="pt-res-row-title">{topicLabel(topic.topic)}</h3>
                    <span className="pt-res-row-share pt-data">
                      {formatPortalString(strings.topicShare, { correct: String(topic.correctCount), total: String(topic.totalCount) })}
                    </span>
                  </div>
                  <meter
                    className="pt-res-meter"
                    min={0}
                    max={topic.totalCount}
                    value={topic.correctCount}
                    aria-label={formatPortalString(strings.topicMeterAria, {
                      topic: topicLabel(topic.topic),
                      correct: String(topic.correctCount),
                      total: String(topic.totalCount),
                    })}
                  />
                  <p className="pt-res-note">
                    {topic.totalCount < 4
                      ? strings.topicFewTasks
                      : topic.correctCount / topic.totalCount >= 0.75
                        ? strings.topicStrong
                        : strings.topicPractice}
                  </p>
                  <p className="pt-res-text">{result.metadata.recommendations?.[topic.topic as "grammar" | "vocabulary" | "reading"]}</p>
                </div>
              ))}
            </div>
          </section>
          <section aria-labelledby="english-review">
            <h2 id="english-review" className="pt-section-title">{strings.reviewSectionHeading}</h2>
            <p className="pt-res-note">{strings.reviewSectionNote}</p>
            <div className="pt-res-stack">
              {english.feedback.map((feedback, index) => {
                const question = attempt.questions.find((q) => q.id === feedback.questionId);
                const skill = result.metadata.blueprint?.find((b) => b.questionId === feedback.questionId)?.skill;
                const label = (skill && result.metadata.skillLabels?.[skill]) || knownTopic(feedback.topic) || strings.feedbackFallbackTopic;
                return (
                  <details key={feedback.questionId} className="pt-res-details">
                    <summary className="pt-res-summary-line">
                      {index + 1}. {feedback.correct ? strings.feedbackCorrect : strings.feedbackNeedsReview} — {label}
                    </summary>
                    <div className="pt-res-details-body">
                      {question?.passage ? <p lang="en" className="pt-res-passage">{question.passage}</p> : null}
                      <p lang="en" className="pt-res-term">{question?.prompt}</p>
                      <p>{strings.yourAnswer} <span lang="en">{question?.options.find((o) => o.id === feedback.selectedOptionId)?.label}</span></p>
                      <p>{strings.correctAnswer} <span lang="en">{question?.options.find((o) => o.id === feedback.correctOptionId)?.label}</span></p>
                      <p>{feedback.explanation}</p>
                    </div>
                  </details>
                );
              })}
            </div>
          </section>
        </>
      ) : null}

      {orvis ? (
        <>
          <section aria-labelledby="career-scales">
            <h2 id="career-scales" className="pt-section-title">{strings.scalesHeading}</h2>
            <p className="pt-res-note">{strings.scalesNote}</p>
            <div className="pt-res-list">
              {scales.map((s) => (
                <div key={s.scale} className="pt-res-row">
                  <div className="pt-res-row-head">
                    <h3 className="pt-res-row-title">
                      {result.metadata.scales?.find((m) => m.id === s.scale)?.label ?? strings[`scale.${s.scale as OrvisScale}`]}
                    </h3>
                    <span className="pt-res-row-share pt-data">
                      {formatPortalString(strings.scaleShare, { mean: s.mean.toFixed(2) })}
                    </span>
                  </div>
                  <meter
                    className="pt-res-meter"
                    min={1}
                    max={5}
                    value={s.mean}
                    aria-label={formatPortalString(strings.scaleMeterAria, {
                      scale: strings[`scale.${s.scale as OrvisScale}`],
                      mean: s.mean.toFixed(2),
                    })}
                  />
                  <p className="pt-res-note">{result.metadata.scales?.find((m) => m.id === s.scale)?.description}</p>
                </div>
              ))}
            </div>
          </section>
          <section aria-labelledby="career-explore">
            <h2 id="career-explore" className="pt-section-title">{strings.professionsHeading}</h2>
            <p className="pt-res-note">{strings.professionsNote}</p>
            {result.metadata.professionAttribution ? (
              <p className="pt-res-note">{result.metadata.professionAttribution}</p>
            ) : null}
            <div className="pt-res-grid">
              {preferred.map((p) => <ProfessionCard key={p.id} profession={p} strings={strings} />)}
            </div>
            {other.length ? (
              <details className="pt-res-more">
                <summary className="pt-res-summary-line pt-res-more-line">{strings.showOtherProfessions}</summary>
                <div className="pt-res-grid">
                  {other.map((p) => <ProfessionCard key={p.id} profession={p} strings={strings} />)}
                </div>
              </details>
            ) : null}
          </section>
        </>
      ) : null}

      <details className="pt-res-details">
        <summary className="pt-res-summary-line">{strings.limitationsSummary}</summary>
        <ul className="pt-res-bullets pt-res-details-body">
          {result.metadata.limitations.map((item) => <li key={item}>{item}</li>)}
        </ul>
      </details>
      <Link href="/portal/tests" className="pt-btn-ghost pt-res-back">{strings.backToTests}</Link>
    </div>
  );
}
