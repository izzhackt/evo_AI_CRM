"use client";

import { useId, useRef, useState } from "react";

import type { PortalStrings } from "@/lib/portal/i18n";
import { reportCscaItemAction } from "@/lib/portal/csca-actions";

type Strings = PortalStrings<"csca">;
type Phase = "closed" | "open" | "sending" | "sent";

/**
 * «Сообщить об ошибке» под каждым заданием (контракт §10): раскрывается на
 * месте, без модального окна. Текст 1..500 знаков; Admin видит задание и
 * текст, автора не видит никто. Повтор после сбоя идёт с тем же request_id.
 */
export function ReportItem({ itemKey, strings }: { itemKey: string; strings: Strings }) {
  const [phase, setPhase] = useState<Phase>("closed");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef<string | null>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const fieldId = useId();
  const hintId = useId();

  async function send() {
    const text = message.trim();
    if (!text) {
      setError(strings.reportEmpty);
      field.current?.focus();
      return;
    }
    requestId.current ??= crypto.randomUUID();
    setPhase("sending");
    setError(null);
    try {
      const response = await reportCscaItemAction({ itemKey, message: text, requestId: requestId.current });
      if (response.ok) {
        setPhase("sent");
        setMessage("");
        requestId.current = null;
        requestAnimationFrame(() => toggle.current?.focus());
        return;
      }
      if (response.code !== "unavailable") requestId.current = null;
      setError(response.code === "report_limit" ? strings.reportLimit : strings.reportFailed);
      setPhase("open");
    } catch {
      setError(strings.reportFailed);
      setPhase("open");
    }
  }

  if (phase === "closed" || phase === "sent") {
    return (
      <div className="cs-report">
        <button
          ref={toggle}
          type="button"
          className="cs-text-btn cs-report-toggle"
          aria-expanded={false}
          onClick={() => {
            setPhase("open");
            requestAnimationFrame(() => field.current?.focus());
          }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M3.5 14V2.5M3.5 3h8l-1.6 3 1.6 3h-8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {strings.reportOpen}
        </button>
        <span className="cs-report-sent" role="status">{phase === "sent" ? strings.reportSent : ""}</span>
      </div>
    );
  }

  return (
    <form
      className="cs-report cs-report-open"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <label htmlFor={fieldId} className="cs-report-label">{strings.reportLabel}</label>
      <textarea
        ref={field}
        id={fieldId}
        className="cs-report-field"
        maxLength={500}
        rows={3}
        value={message}
        aria-describedby={hintId}
        aria-invalid={error === strings.reportEmpty ? true : undefined}
        disabled={phase === "sending"}
        onChange={(event) => setMessage(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setPhase("closed");
            requestAnimationFrame(() => toggle.current?.focus());
          }
        }}
      />
      <p id={hintId} className="cs-report-hint">
        {strings.reportHint} <span className="pt-data">{message.trim().length}/500</span>
      </p>
      {error ? <p role="alert" className="cs-report-error">{error}</p> : null}
      <div className="cs-report-actions">
        <button type="submit" className="pt-btn-ghost" disabled={phase === "sending"}>
          {phase === "sending" ? strings.reportSending : strings.reportSend}
        </button>
        <button
          type="button"
          className="cs-text-btn"
          disabled={phase === "sending"}
          onClick={() => {
            setPhase("closed");
            setError(null);
            requestAnimationFrame(() => toggle.current?.focus());
          }}
        >
          {strings.reportCancel}
        </button>
      </div>
    </form>
  );
}
