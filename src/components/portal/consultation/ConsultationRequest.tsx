"use client";

import { useState, useTransition } from "react";

import {
  CONSULTATION_NOTE_LIMIT,
  type ConsultationReceipt,
} from "@/lib/portal/consultation";
import { createConsultationRequestAction } from "@/lib/portal/consultation-actions";

export type ConsultationRequestStrings = Readonly<{
  hint: string;
  ctaButton: string;
  noteLabel: string;
  notePlaceholder: string;
  submit: string;
  cancel: string;
  sent: string;
  error: string;
}>;

/**
 * «Записаться на консультацию» (PORT-5b, план §6): кнопка раскрывает малую
 * форму с необязательной заметкой; после подтверждения сервером — честное
 * состояние «Запрос отправлен — менеджер свяжется». request_id стабилен на
 * попытку, а RPC миграции 197 держит не более одного открытого запроса —
 * повтор нажатия и retry сети никогда не создают дубль: сервер возвращает
 * существующий открытый receipt, и экран показывает его состояние.
 */
export function ConsultationRequest({
  institutionId = null,
  initialOpenRequest,
  strings,
}: {
  /** null — запрос из профиля, без выбранного вуза. */
  institutionId?: string | null;
  /** Открытый запрос на момент рендера; null — открытого нет. */
  initialOpenRequest: ConsultationReceipt | null;
  strings: ConsultationRequestStrings;
}) {
  const [requestId] = useState(() => crypto.randomUUID());
  const [openRequest, setOpenRequest] = useState(initialOpenRequest);
  const [expanded, setExpanded] = useState(false);
  const [note, setNote] = useState("");
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  if (openRequest !== null) {
    // A11y (PORT-6a): успех размонтирует форму вместе с кнопкой отправки,
    // на которой стоял фокус, — без переноса он молча падал на <body>.
    // Фокусируем статус только когда запрос отправлен в этой сессии.
    return (
      <p
        role="status"
        tabIndex={-1}
        ref={(node) => {
          if (node && openRequest !== initialOpenRequest) node.focus();
        }}
        className="pt-consult-sent"
      >
        {strings.sent}
      </p>
    );
  }

  const submit = () => {
    setFailed(false);
    startTransition(async () => {
      const result = await createConsultationRequestAction(
        requestId,
        institutionId,
        note.trim() === "" ? null : note.trim(),
      );
      if (result.ok) {
        setOpenRequest(result.receipt);
      } else {
        setFailed(true);
      }
    });
  };

  if (!expanded) {
    return (
      <div className="pt-consult">
        <p className="pt-profile-hint">{strings.hint}</p>
        <button type="button" className="pt-btn" onClick={() => setExpanded(true)}>
          {strings.ctaButton}
        </button>
      </div>
    );
  }

  return (
    <form
      className="pt-consult"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <p className="pt-profile-hint">{strings.hint}</p>
      <label className="pt-field">
        <span className="pt-field-label">{strings.noteLabel}</span>
        <textarea
          className="pt-consult-note"
          rows={3}
          maxLength={CONSULTATION_NOTE_LIMIT}
          placeholder={strings.notePlaceholder}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      <div className="pt-consult-actions">
        <button type="submit" className="pt-btn" disabled={pending}>
          {strings.submit}
        </button>
        <button
          type="button"
          className="pt-btn-ghost"
          disabled={pending}
          onClick={() => {
            setExpanded(false);
            setFailed(false);
          }}
        >
          {strings.cancel}
        </button>
      </div>
      {failed ? (
        <p role="alert" className="pt-favorite-error">{strings.error}</p>
      ) : null}
    </form>
  );
}
