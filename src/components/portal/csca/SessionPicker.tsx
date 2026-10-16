"use client";

import { useState } from "react";

import { formatPortalString, type PortalStrings } from "@/lib/portal/i18n";
import { daysBetween, type CscaSession } from "@/lib/portal/csca";
import { setCscaTargetSessionAction } from "@/lib/portal/csca-actions";

import type { SessionLabels } from "./session-labels";

type Strings = PortalStrings<"csca">;

const VISIBLE = 3;


/**
 * Официальный календарь сессий (контракт §3, §11): даты как факт с датой
 * проверки и ссылкой на csca.cn; окно регистрации только там, где его
 * опубликовал csca.cn. Выбор «Моя сессия» хранит сервер; обратный отсчёт
 * считается от даты экзамена. Ничего не обещаем и не напоминаем.
 */
export function SessionPicker({
  sessions,
  labels,
  verifiedLabel,
  initialTarget,
  today,
  strings,
}: {
  sessions: CscaSession[];
  labels: SessionLabels;
  verifiedLabel: string;
  initialTarget: string | null;
  today: string;
  strings: Strings;
}) {
  const [target, setTarget] = useState(initialTarget);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  async function choose(sessionKey: string | null, rowKey: string) {
    setBusyKey(rowKey);
    setFailed(false);
    try {
      const response = await setCscaTargetSessionAction(sessionKey);
      if (response.ok) setTarget(response.targetSessionKey);
      else setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setBusyKey(null);
    }
  }

  if (sessions.length === 0) return null;
  const ordered = [...sessions].sort((a, b) => a.examFrom.localeCompare(b.examFrom));
  const targetIndex = ordered.findIndex((session) => session.sessionKey === target);
  const visibleCount = Math.max(VISIBLE, targetIndex + 1);

  const row = (session: CscaSession) => {
    const chosen = session.sessionKey === target;
    const dates = labels[session.sessionKey]?.dates ?? session.examFrom;
    const daysLeft = daysBetween(today, session.examFrom);
    return (
      <li key={session.sessionKey} className="cs-session" data-chosen={chosen ? "" : undefined}>
        <div className="cs-session-body">
          <p className="cs-session-dates">{dates}</p>
          <p className="cs-session-reg">{labels[session.sessionKey]?.registration}</p>
          {chosen && daysLeft >= 0 ? (
            <p className="cs-session-days pt-data">
              {formatPortalString(strings.sessionDaysLeft, { count: String(daysLeft) })}
            </p>
          ) : null}
        </div>
        {chosen ? (
          <span className="cs-session-actions">
            <span className="cs-chip cs-chip-on">{strings.sessionTarget}</span>
            <button type="button" className="cs-text-btn" disabled={busyKey !== null} onClick={() => void choose(null, session.sessionKey)}>
              {busyKey === session.sessionKey ? strings.sessionSaving : strings.sessionClear}
            </button>
          </span>
        ) : (
          <button
            type="button"
            className="pt-btn-ghost cs-session-choose"
            disabled={busyKey !== null}
            aria-label={`${strings.sessionChoose}: ${dates}`}
            onClick={() => void choose(session.sessionKey, session.sessionKey)}
          >
            {busyKey === session.sessionKey ? strings.sessionSaving : strings.sessionChoose}
          </button>
        )}
      </li>
    );
  };

  return (
    <section className="cs-panel" aria-labelledby="cs-sessions-title">
      <h2 id="cs-sessions-title" className="cs-panel-title">{strings.sessionsHeading}</h2>
      <p className="cs-panel-lead">
        {formatPortalString(strings.sessionsLead, { date: verifiedLabel })}
      </p>
      <ul className="cs-sessions">{ordered.slice(0, visibleCount).map(row)}</ul>
      {ordered.length > visibleCount ? (
        <details className="cs-sessions-more">
          <summary>{formatPortalString(strings.sessionsMore, { count: String(ordered.length - visibleCount) })}</summary>
          <ul className="cs-sessions">{ordered.slice(visibleCount).map(row)}</ul>
        </details>
      ) : null}
      {failed ? <p role="alert" className="cs-report-error">{strings.errorUnavailable}</p> : null}
      <p className="cs-panel-foot">
        <a className="pt-link" href={ordered[0].sourceUrl} target="_blank" rel="noopener noreferrer">
          {strings.sessionSource}
        </a>
      </p>
    </section>
  );
}
