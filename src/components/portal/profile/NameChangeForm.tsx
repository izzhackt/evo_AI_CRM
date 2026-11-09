"use client";

import { useActionState, useState } from "react";

import type { PortalStrings } from "@/lib/portal/i18n";
import { PORTAL_NAME_MAX, splitPortalDisplayName, type PortalNameState } from "@/lib/portal/portal-profile";
import { setPortalNameAction } from "@/lib/portal/portal-profile-actions";

const MESSAGE_KEY = {
  done: "nameDone",
  invalid: "nameInvalid",
  unavailable: "nameUnavailable",
} as const;

/**
 * «Профиль → Имя и фамилия» (356, 09.11.2026): студент правит их сам — у кабинетов, открытых из CRM, фамилии часто нет.
 * Пользователь: «нужно сделать это минималистичнее». Карточка — одна строка «Имя Фамилия · Изменить»; по «Изменить»
 * два поля в ряд и «Готово» / «Отмена», после записи снова строка. Новое имя видно в кабинете и в деле CRM; логин для
 * входа не меняется. Номер запроса — один на попытку: после ответа сервера он новый.
 */
export function NameChangeForm({ displayName, strings }: Readonly<{ displayName: string; strings: PortalStrings<"profile"> }>) {
  const [editing, setEditing] = useState(false);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [state, action, pending] = useActionState(async (previous: PortalNameState, form: FormData) => {
    const next = await setPortalNameAction(previous, form);
    if (next.status !== "unavailable") setRequestId(crypto.randomUUID());
    if (next.status === "done") setEditing(false);
    return next;
  }, { status: "idle" } as PortalNameState);
  const shown = state.status === "done" && state.displayName ? state.displayName : displayName;
  const initial = splitPortalDisplayName(shown);
  const message = state.status === "idle" ? "" : strings[MESSAGE_KEY[state.status]];
  const good = state.status === "done";

  if (!editing) {
    return (
      <div className="pt-name-row" data-testid="portal-name-change">
        <p className="pt-name-value">
          {initial.lastName ? `${initial.firstName} ${initial.lastName}` : <>{initial.firstName} <span className="pt-name-missing">{strings.nameMissing}</span></>}
        </p>
        <button type="button" className="pt-btn-ghost" onClick={() => setEditing(true)}>{strings.nameEdit}</button>
        {good ? <p role="status" className="pt-password-note pt-name-saved">{message}</p> : null}
      </div>
    );
  }

  return (
    <form action={action} className="pt-name-form" data-testid="portal-name-change">
      <input type="hidden" name="request_id" value={requestId} />
      <div className="pt-name-fields">
        <label className="pt-field">
          <span className="pt-field-label">{strings.nameFirst}</span>
          <input className="pt-input" type="text" name="first_name" autoComplete="given-name" maxLength={PORTAL_NAME_MAX}
            defaultValue={initial.firstName} required autoFocus />
        </label>
        <label className="pt-field">
          <span className="pt-field-label">{strings.nameLast}</span>
          <input className="pt-input" type="text" name="last_name" autoComplete="family-name" maxLength={PORTAL_NAME_MAX}
            defaultValue={initial.lastName} required />
        </label>
      </div>
      <div className="pt-password-actions">
        <button type="submit" className="pt-btn" disabled={pending}>{pending ? strings.nameSaving : strings.nameSubmit}</button>
        <button type="button" className="pt-btn-ghost" disabled={pending} onClick={() => setEditing(false)}>{strings.nameCancel}</button>
        {message && !good ? <p role="alert" className="pt-account-deletion-error">{message}</p> : null}
      </div>
      <p className="pt-password-note">{strings.nameHint}</p>
    </form>
  );
}
