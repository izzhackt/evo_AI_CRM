"use client";

import { useState, useTransition } from "react";

import { requestAccountDeletionAction } from "@/lib/portal/portal-profile-actions";

export type DeleteAccountStrings = Readonly<{
  deleteDescription: string;
  deleteConfirm: string;
  deleteRequested: string;
  deleteError: string;
}>;

/**
 * Инициирование удаления аккаунта (PORT-5a, план §13, App Store §5.1.1(v)):
 * честное описание последствий, реальный серверный запрос со статусом
 * «запрос отправлен — обрабатывается командой» (без обещаний сроков).
 * request_id стабилен на попытку — повтор нажатия и retry сети идемпотентны
 * (миграция 196: не более одного открытого запроса на участника).
 */
export function DeleteAccountRequest({
  initialRequestedAt,
  strings,
}: {
  initialRequestedAt: string | null;
  strings: DeleteAccountStrings;
}) {
  const [requestId] = useState(() => crypto.randomUUID());
  const [requestedAt, setRequestedAt] = useState(initialRequestedAt);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  if (requestedAt !== null) {
    return <p role="status" className="pt-profile-deletion-state">{strings.deleteRequested}</p>;
  }

  return (
    <div className="pt-profile-deletion">
      <p className="pt-profile-hint">{strings.deleteDescription}</p>
      <button
        type="button"
        className="pt-btn-danger"
        disabled={pending}
        onClick={() => {
          setFailed(false);
          startTransition(async () => {
            const result = await requestAccountDeletionAction(requestId);
            if (result.ok) {
              setRequestedAt(result.requestedAt);
            } else {
              setFailed(true);
            }
          });
        }}
      >
        {strings.deleteConfirm}
      </button>
      {failed ? (
        <p role="alert" className="pt-favorite-error">{strings.deleteError}</p>
      ) : null}
    </div>
  );
}
