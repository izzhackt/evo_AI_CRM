"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { StatusChip } from "@/components/v3/blocks/StatusChip";
import { QUEUE_CONFIRM, QUEUE_SECONDARY } from "@/components/v3/queue/queue-buttons";
import {
  normalizeTelephonyMapReceipt,
  telephonyErrorMessage,
  type TelephonyExtension,
  type TelephonyStaffOption,
} from "@/lib/v3/telephony-settings";

/**
 * Сопоставление пользователей ВАТС и сотрудников EVO (план телефонии §6.3). Список
 * пользователей приходит от сервера из `GET /users`; сотрудника он не
 * назначает — выбирает и подтверждает человек с правом `telephony.manage`. Выбор
 * не пишет ничего: запись идёт после «Подтвердить», с тем, что человек видел
 * («было»), — если сопоставление успели изменить, база откажет (PT409).
 * Звонки, сохранённые до сопоставления, сотрудника не получают: экран говорит
 * об этом числом.
 */

const fieldCls = "h-11 min-w-0 rounded-ctl border border-control-edge bg-surface px-3 t-body text-fg hover:bg-surface-2 focus-visible:border-accent disabled:bg-surface-2 disabled:text-fg-3";

function ExtensionRow({
  extension,
  staff,
  takenBy,
  readOnly,
}: Readonly<{
  extension: TelephonyExtension;
  staff: readonly TelephonyStaffOption[];
  /** Сотрудники, уже сопоставленные с другим действующим пользователем ВАТС. */
  takenBy: ReadonlySet<string>;
  readOnly: boolean;
}>) {
  const router = useRouter();
  const [choice, setChoice] = useState(extension.membershipId ?? "");
  // Страница обновилась с чужим сопоставлением: выбор следует за базой, а не за прежним экраном.
  const [seenMembership, setSeenMembership] = useState(extension.membershipId);
  if (seenMembership !== extension.membershipId) {
    setSeenMembership(extension.membershipId);
    setChoice(extension.membershipId ?? "");
  }
  const [confirming, setConfirming] = useState(false);
  // Сопоставленному выбор не нужен, пока не нажали «Изменить»: имя и «Изменить» — вместо списка, который только повторял бы имя.
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [message, setMessage] = useState<Readonly<{ tone: "ok" | "error"; text: string }> | null>(null);

  const label = extension.name ?? extension.login;
  const target = staff.find((option) => option.membershipId === choice) ?? null;
  const changed = choice !== (extension.membershipId ?? "");
  const chip = !extension.active
    ? <StatusChip label="Выключен в ВАТС" tone="neutral" />
    : extension.membershipId
      ? <StatusChip label="Сопоставлен" tone="ok" />
      : <StatusChip label="Не сопоставлен" tone="warn" />;

  async function confirm() {
    if (pending) return;
    setPending(true);
    setMessage(null);
    const id = requestId ?? crypto.randomUUID();
    setRequestId(id);
    try {
      const response = await fetch("/api/v3/telephony/extensions", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          requestId: id,
          extensionId: extension.id,
          previousMembershipId: extension.membershipId,
          membershipId: choice || null,
        }),
      });
      const body = (await response.json().catch(() => null)) as { receipt?: unknown; error?: { code?: string; constraint?: string } } | null;
      if (response.ok && normalizeTelephonyMapReceipt(body?.receipt)) {
        setRequestId(null);
        setConfirming(false);
        setEditing(false);
        setMessage({ tone: "ok", text: "Сохранено." });
        router.refresh();
      } else if (response.status >= 400 && response.status < 500) {
        // Определённый отказ базы: тот же запрос ничего не изменит — новый id.
        setRequestId(null);
        setConfirming(false);
        setMessage({ tone: "error", text: telephonyErrorMessage(body?.error?.code, body?.error?.constraint) });
      } else {
        // Результат неизвестен: повтор уйдёт с тем же id, и база вернёт прежнюю квитанцию.
        setMessage({ tone: "error", text: telephonyErrorMessage(null) });
      }
    } catch {
      setMessage({ tone: "error", text: telephonyErrorMessage(null) });
    } finally {
      setPending(false);
    }
  }

  return (
    <li className="px-4 py-3" data-testid="v3-telephony-extension" data-extension={extension.login} data-mapped={extension.membershipId ? "yes" : "no"}>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <p className="t-item text-fg">{label}</p>
          <p className="t-meta text-fg-2">
            {extension.extension ? `внутр. ${extension.extension} · ` : ""}логин {extension.login}
          </p>
        </div>
        {chip}
      </div>
      {extension.membershipId && !confirming ? (
        <p className="mt-1 flex min-h-11 flex-wrap items-center gap-x-2 t-body-compact text-fg-2">
          {/* Имя сотрудника, только если оно не то же, что у пользователя ВАТС выше: иначе одно и то же стояло бы дважды. */}
          {extension.membershipName !== label ? <span>Сотрудник: <span className="text-fg">{extension.membershipName ?? "не найден"}</span></span> : null}
          {!readOnly && !editing ? (
            <button type="button" className="inline-flex min-h-11 items-center t-label text-fg-2 underline underline-offset-4 hover:text-fg"
              data-testid="v3-telephony-extension-edit" onClick={() => setEditing(true)}>
              {extension.membershipName !== label ? "Изменить" : "Изменить сопоставление"}
            </button>
          ) : null}
        </p>
      ) : null}
      {extension.legsWithoutStaff > 0 ? (
        <p className="mt-1 t-meta text-fg-3" data-testid="v3-telephony-extension-legs">
          Звонков без сотрудника: {extension.legsWithoutStaff}. Они сотруднику не переносятся: сопоставление действует на новые звонки.
        </p>
      ) : null}
      {!extension.active && !extension.membershipId ? (
        <p className="mt-1 t-meta text-fg-3">Пользователь выключен в ВАТС: сопоставлять нечего.</p>
      ) : null}
      {readOnly || (!extension.active && !extension.membershipId) || (extension.membershipId && !editing && !confirming) ? null : (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor={`tel-ext-${extension.id}`}>Сотрудник EVO для пользователя ВАТС {label}</label>
          <select
            id={`tel-ext-${extension.id}`}
            className={`${fieldCls} w-64 max-w-full`}
            value={choice}
            disabled={pending || confirming}
            onChange={(event) => { setChoice(event.target.value); setMessage(null); }}
          >
            <option value="">Сотрудник не выбран</option>
            {staff.map((option) => (
              <option key={option.membershipId} value={option.membershipId}
                disabled={takenBy.has(option.membershipId) && option.membershipId !== extension.membershipId}>
                {option.name}{takenBy.has(option.membershipId) && option.membershipId !== extension.membershipId ? " · уже сопоставлен" : ""}
              </option>
            ))}
          </select>
          {/* «Сопоставить…» есть, только когда выбор изменён: серая кнопка, которую нельзя нажать, у каждой строки списка была шумом. */}
          {confirming || !changed ? null : (
            <button type="button" className={QUEUE_SECONDARY} disabled={pending} onClick={() => { setConfirming(true); setMessage(null); }}>
              {choice || !extension.membershipId ? "Сопоставить…" : "Снять сопоставление…"}
            </button>
          )}
          {editing && !confirming ? (
            <button type="button" className="inline-flex min-h-11 items-center t-label text-fg-2 underline underline-offset-4 hover:text-fg"
              onClick={() => { setEditing(false); setChoice(extension.membershipId ?? ""); setMessage(null); }}>
              Отмена
            </button>
          ) : null}
        </div>
      )}
      {confirming ? (
        <div className="mt-2 rounded-ctl border border-border bg-surface-2 px-3 py-2.5" role="group" aria-label="Подтверждение сопоставления" data-testid="v3-telephony-extension-confirm">
          <p className="t-body-compact text-fg">
            {target
              ? <>Новые звонки пользователя ВАТС «{label}» будут записываться на сотрудника «{target.name}».</>
              : <>Звонки пользователя ВАТС «{label}» перестанут записываться на сотрудника.</>}
            {" "}Уже сохранённые звонки не меняются.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" className={QUEUE_CONFIRM} disabled={pending} onClick={confirm}>
              {pending ? "Сохраняю…" : "Подтвердить"}
            </button>
            <button type="button" className={QUEUE_SECONDARY} disabled={pending}
              onClick={() => { setConfirming(false); setEditing(false); setChoice(extension.membershipId ?? ""); setMessage(null); }}>
              Отмена
            </button>
          </div>
        </div>
      ) : null}
      {message ? (
        <p role={message.tone === "ok" ? "status" : "alert"} className={`mt-1 t-body-compact ${message.tone === "ok" ? "text-fg-2" : "text-danger"}`}>{message.text}</p>
      ) : null}
    </li>
  );
}

export function TelephonyExtensions({
  extensions,
  staff,
  readOnly,
}: Readonly<{
  extensions: readonly TelephonyExtension[];
  staff: readonly TelephonyStaffOption[];
  readOnly: boolean;
}>) {
  const takenBy = new Set(extensions.filter((item) => item.active && item.membershipId).map((item) => item.membershipId as string));
  const unmapped = extensions.filter((item) => item.active && !item.membershipId).length;
  return (
    <section aria-labelledby="tel-extensions-title" data-testid="v3-telephony-extensions">
      <h3 id="tel-extensions-title" className="t-section mb-1 text-fg">Пользователи ВАТС и сотрудники</h3>
      <p className="mb-2 max-w-prose t-body-compact text-fg-2">
        Список приходит из ВАТС сам. Сотрудника выбираете и подтверждаете вы: пока пользователь не сопоставлен, его звонки
        сохраняются без сотрудника. Сопоставьте до включения разбора звонков.
        {unmapped > 0 ? ` Не сопоставлено: ${unmapped}.` : ""}
      </p>
      {extensions.length === 0 ? (
        <p className="rounded-card border border-border bg-surface px-4 py-3 t-body-compact text-fg-2" data-testid="v3-telephony-extensions-empty">
          Пользователей ВАТС пока нет. Список появится после того, как на сервере задан ключ ВАТС и фоновая работа его получила.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-card border border-border bg-surface">
          {extensions.map((extension) => (
            <ExtensionRow key={extension.id} extension={extension} staff={staff} takenBy={takenBy} readOnly={readOnly} />
          ))}
        </ul>
      )}
    </section>
  );
}
