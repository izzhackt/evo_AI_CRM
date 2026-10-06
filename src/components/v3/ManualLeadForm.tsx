"use client";
import Link from "next/link";
import { createContext, useActionState, useContext, useId, useRef, useState } from "react";
import { btnCls, inputCls, fieldLabelCls } from "@/components/ui";
import { LEAD_CHANNEL_REQUIRED, LEAD_CHANNEL_UNKNOWN_HINT, LEAD_CHANNELS } from "@/lib/lead-channel-contract";
import { createManualLeadAction } from "@/lib/platform-manual-lead-actions";
import { LEAD_DIRECTIONS, MANUAL_LEAD_SOURCE_REQUIRED, MANUAL_LEAD_SOURCES, type ManualLeadState } from "@/lib/platform-manual-lead-contract";

type DisclosureState = Readonly<{ open: boolean; toggle: () => void }>;
const ManualLeadDisclosureContext = createContext<DisclosureState | null>(null);

/**
 * Общее состояние открытия для кнопки в шапке экрана (`ManualLeadTrigger`,
 * действие `PartShell`) и панели формы ниже (`ManualLeadForm`, в содержимом
 * страницы) — один главный вход, а не собственная кнопка внутри списка.
 */
export function ManualLeadDisclosure({ children }: Readonly<{ children: React.ReactNode }>) {
  const [open, setOpen] = useState(false);
  return (
    <ManualLeadDisclosureContext.Provider value={{ open, toggle: () => setOpen((value) => !value) }}>
      {children}
    </ManualLeadDisclosureContext.Provider>
  );
}

function useManualLeadDisclosure(): DisclosureState {
  const ctx = useContext(ManualLeadDisclosureContext);
  if (!ctx) throw new Error("ManualLeadTrigger/ManualLeadForm requires ManualLeadDisclosure");
  return ctx;
}

/**
 * `quiet` — второй вход в ту же форму (пустые «Заявки», Э3): тихая ссылка,
 * потому что сплошной красный у страницы один — кнопка в шапке.
 */
export function ManualLeadTrigger({ quiet = false }: Readonly<{ quiet?: boolean }>) {
  const { open, toggle } = useManualLeadDisclosure();
  return (
    <button type="button" aria-expanded={open} aria-controls="manual-lead-panel" onClick={toggle}
      className={quiet ? "inline-flex min-h-11 items-center t-label text-fg-2 underline underline-offset-4 hover:text-fg" : btnCls}>
      Добавить лида
    </button>
  );
}

/**
 * `owners: null` — список ответственных не прочитан (сбой чтения): панель
 * вместо полей говорит, что список не загрузился, а не «нет доступного
 * ответственного» — это была бы неправда о доступе сотрудников.
 */
export function ManualLeadForm(props: Readonly<{ requestId: string; ownerId: string; owners: readonly Readonly<{ id: string; displayName: string }>[] | null }>) {
  const { open } = useManualLeadDisclosure();
  const [requestId, setRequestId] = useState(props.requestId);
  if (!open) return null;
  return (
    <div id="manual-lead-panel" className="mt-5 rounded-card border border-border bg-surface p-4">
      {props.owners === null
        ? <p role="status" className="text-sm text-fg-2">Список ответственных не загрузился, поэтому добавить лида сейчас нельзя. Обновите страницу.</p>
        : props.owners.length ? <ManualLeadEditor key={requestId} {...props} owners={props.owners} requestId={requestId} onAnother={() => setRequestId(crypto.randomUUID())} />
        : <p role="status" className="text-sm text-fg-2">Нет доступного ответственного. Лида можно назначить активному администратору или сотруднику продаж. Проверьте доступ сотрудников в настройках команды и обновите страницу.</p>}
    </div>
  );
}
/**
 * Что сказать про «Откуда узнал» после ответа: выбор пишется отдельным вызовом, и он может не записаться;
 * у повторного контакта канал уже мог быть записан раньше — его правят в карточке, а не новым выбором.
 */
function touchNote(state: ManualLeadState): string {
  if (state.touch === "forbidden") return " «Откуда узнал» не записано: нет права менять этого лида.";
  if (state.touch === "failed") return " «Откуда узнал» не записалось — укажите его в карточке лида.";
  if (state.status === "duplicate") return state.leadId ? " «Откуда узнал» уточняйте в карточке лида." : " «Откуда узнал» для него не записано.";
  return "";
}

/**
 * Браузер шлёт `invalid` каждому пустому полю по порядку; `preventDefault` убирает его собственный фокус,
 * поэтому фокус ставим сами и только на первое неверное поле — иначе его забрало бы последнее.
 */
function focusFirstInvalid(field: HTMLSelectElement) {
  // Только поля: `fieldset` с пустым полем внутри тоже `:invalid` и стоит раньше в порядке документа.
  if (field.form?.querySelector("input:invalid, select:invalid, textarea:invalid") === field) field.focus();
}

function ManualLeadEditor({ requestId, ownerId, owners, onAnother }: Readonly<{ requestId: string; ownerId: string; owners: readonly Readonly<{ id: string; displayName: string }>[]; onAnother: () => void }>) {
  const frozen = useRef<FormData | null>(null);
  const [currentRequestId, setCurrentRequestId] = useState(requestId);
  // Источник не выбран — браузер не отправляет форму и говорит «Выберите
  // источник» под полем (Э8.11); сервер отвечает тем же словом.
  const [sourceMissing, setSourceMissing] = useState(false);
  const sourceErrorId = useId();
  // «Откуда узнал» — то же правило: без значения по умолчанию, «Не известно» выбирают явно.
  const [channelMissing, setChannelMissing] = useState(false);
  const [channelUnknown, setChannelUnknown] = useState(false);
  const channelErrorId = useId();
  const channelHintId = useId();
  const [state, action, pending] = useActionState(async (previous: ManualLeadState, form: FormData): Promise<ManualLeadState> => {
    const submitted = frozen.current ?? form;
    frozen.current = submitted;
    try {
      const result = await createManualLeadAction(previous, submitted);
      if (result.status !== "unavailable") frozen.current = null;
      return result;
    } catch { return { ...previous, status: "unavailable" }; }
  }, { status: "idle", requestId, leadId: null } as ManualLeadState);
  const locked = pending || ["saved", "unavailable"].includes(state.status)
    || (state.status === "request_conflict" && currentRequestId === state.requestId);
  const messages: Record<ManualLeadState["status"], string> = {
    idle: "", saved: "Лид сохранён. Сообщения и приглашения не отправлялись.", duplicate: "Такой контакт уже есть. Откройте существующего лида; если ссылка недоступна, попросите Admin проверить контакт.",
    invalid: "Проверьте имя, контакт и дату следующего действия.", source_required: `${MANUAL_LEAD_SOURCE_REQUIRED}.`, channel_required: `${LEAD_CHANNEL_REQUIRED}.`, forbidden: "Нет права на это действие. Обновите страницу после проверки доступа.",
    request_conflict: "Запрос уже использован с другими данными. Сначала проверьте воронку.", unavailable: "Результат пока неизвестен. Данные сохранены в форме; безопасно повторите тот же запрос.",
  };
  return <form action={action} className="max-w-3xl space-y-4" aria-busy={pending}>
    <input type="hidden" name="request_id" value={currentRequestId} />
    <fieldset disabled={locked} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label><span className={fieldLabelCls}>Имя</span><input name="name" required maxLength={300} className={inputCls} /></label>
        <label><span className={fieldLabelCls}>Телефон</span><input name="phone" type="tel" maxLength={50} className={inputCls} /></label>
        <label><span className={fieldLabelCls}>Email, если телефона нет</span><input name="email" type="email" maxLength={320} className={inputCls} /></label>
        <label><span className={fieldLabelCls}>Источник</span><select name="source" required defaultValue=""
          aria-invalid={sourceMissing || undefined} aria-describedby={sourceMissing ? sourceErrorId : undefined}
          onInvalid={(event) => {
            // Одно сообщение — строка под полем, без всплывающей подсказки браузера поверх неё.
            event.preventDefault();
            event.currentTarget.setCustomValidity(MANUAL_LEAD_SOURCE_REQUIRED);
            focusFirstInvalid(event.currentTarget);
            setSourceMissing(true);
          }}
          onChange={(event) => { event.currentTarget.setCustomValidity(""); setSourceMissing(false); }}
          className={`${inputCls} aria-[invalid=true]:border-danger`}>
          <option value="">Не выбрано</option>{Object.entries(MANUAL_LEAD_SOURCES).map(([key, value]) => <option key={key} value={key}>{value}</option>)}
        </select>{sourceMissing ? <span id={sourceErrorId} role="alert" className="mt-1 block t-body-compact text-danger">{MANUAL_LEAD_SOURCE_REQUIRED}</span> : null}</label>
        <label><span className={fieldLabelCls}>Откуда узнал</span><select name="channel" required defaultValue=""
          aria-invalid={channelMissing || undefined} aria-describedby={channelMissing ? channelErrorId : channelUnknown ? channelHintId : undefined}
          onInvalid={(event) => {
            event.preventDefault();
            event.currentTarget.setCustomValidity(LEAD_CHANNEL_REQUIRED);
            focusFirstInvalid(event.currentTarget);
            setChannelMissing(true);
          }}
          onChange={(event) => { event.currentTarget.setCustomValidity(""); setChannelMissing(false); setChannelUnknown(event.currentTarget.value === "unknown"); }}
          className={`${inputCls} aria-[invalid=true]:border-danger`}>
          <option value="">Не выбрано</option>{Object.entries(LEAD_CHANNELS).map(([key, value]) => <option key={key} value={key}>{value}</option>)}
        </select>{channelMissing ? <span id={channelErrorId} role="alert" className="mt-1 block t-body-compact text-danger">{LEAD_CHANNEL_REQUIRED}</span>
          : channelUnknown ? <span id={channelHintId} className="mt-1 block t-body-compact text-fg-2">{LEAD_CHANNEL_UNKNOWN_HINT}</span> : null}</label>
        <label><span className={fieldLabelCls}>Ответственный</span><select name="owner_id" defaultValue={ownerId} required className={inputCls}>{owners.map(owner => <option key={owner.id} value={owner.id}>{owner.displayName}</option>)}</select></label>
        <label><span className={fieldLabelCls}>Направление</span><select name="direction" className={inputCls}><option value="">Пока не выбрано</option>{Object.entries(LEAD_DIRECTIONS).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></label>
      </div>
      <details><summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">Следующее действие</summary><div className="grid gap-4 sm:grid-cols-2">
        <label><span className={fieldLabelCls}>Что сделать</span><textarea name="next_action" maxLength={500} rows={2} className={inputCls} /></label>
        <label><span className={fieldLabelCls}>Срок</span><input name="due_date" type="date" className={inputCls} /></label>
      </div></details>
      <button className={btnCls} disabled={locked}>{pending ? "Сохраняем…" : "Сохранить лида"}</button>
    </fieldset>
    {state.status !== "idle" ? <p role={state.status === "saved" ? "status" : "alert"} className="text-sm leading-relaxed text-fg-2">{messages[state.status]}{touchNote(state)}</p> : null}
    {state.leadId ? <Link className="inline-flex min-h-11 items-center text-accent-text underline" href={`/v3/profile?id=${state.leadId}`}>Открыть лида</Link> : null}
    {state.status === "unavailable" ? <button type="submit" className={btnCls} disabled={pending}>Повторить тот же запрос</button> : null}
    {state.status === "saved" ? <button type="button" className="min-h-11 text-sm underline" onClick={onAnother}>Добавить ещё одного</button> : null}
    {state.status === "request_conflict" ? <div className="flex flex-wrap gap-3"><Link href="/v3/pipeline" target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center underline">Проверить воронку в новой вкладке</Link>
      {currentRequestId === state.requestId ? <button type="button" className="min-h-11 text-sm underline" onClick={() => setCurrentRequestId(crypto.randomUUID())}>Проверил, продолжить с моим вводом</button> : null}</div> : null}
  </form>;
}
