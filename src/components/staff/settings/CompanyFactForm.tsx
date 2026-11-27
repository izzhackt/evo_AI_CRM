"use client";
import { startTransition, useActionState, useId, useState } from "react";

import { QUEUE_CONFIRM, QUEUE_FIELD, QUEUE_SECONDARY } from "@/components/staff/queue/queue-buttons";
import { Checkbox } from "@/components/ui/checkbox";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import {
  COMPANY_FACT_AUDIENCES,
  COMPANY_FACT_FORM_GOOD,
  COMPANY_FACT_LIMITS,
  COMPANY_FACT_SOURCES,
  type CompanyFact,
  type CompanyFactFormState,
} from "@/lib/ai-agents/company-facts";
import { retireCompanyFactAction, saveCompanyFactAction } from "@/lib/platform-company-fact-actions";
import {
  COMPANY_FACT_AUDIENCE_HINT,
  COMPANY_FACT_AUDIENCE_WORD,
  COMPANY_FACT_FORM_MESSAGE,
  COMPANY_FACT_SOURCE_WORD,
  companyFactTopicTitle,
  companyFactWords,
} from "@/lib/v3/wording";

const LABEL = "block t-label text-fg-2";

function useFactAction(action: (previous: CompanyFactFormState, form: FormData) => Promise<CompanyFactFormState>) {
  const [request, setRequest] = useState(() => crypto.randomUUID());
  const [state, run, pending] = useActionState(async (previous: CompanyFactFormState, form: FormData): Promise<CompanyFactFormState> => {
    try {
      const result = await action(previous, form);
      // Определённый ответ закрывает запрос; при неизвестном итоге id остаётся, и повтор вернёт прежнюю квитанцию, а не вторую запись.
      if (result.status !== "unavailable") setRequest(crypto.randomUUID());
      return result;
    } catch { return { ...previous, status: "unavailable" }; }
  }, { status: "idle", requestId: request } as CompanyFactFormState);
  return { request, state, run, pending };
}

/**
 * Добавить факт или поправить действующий (панель на странице «Факты»). Изменение текста сохраняется только вместе с «Проверено сегодня»:
 * дата проверки не может покрывать текст, которого никто не проверял. Правка создаёт новую версию, прежняя остаётся в истории.
 * Отправка не через `<form action>`, чтобы введённое не сбрасывалось после ответа (как `CountryCuratorForm`).
 */
export function CompanyFactForm({ fact, onDone, onLockedChange }: Readonly<{
  /** `null` — новый факт. */
  fact: CompanyFact | null;
  onDone?: () => void;
  onLockedChange?: (locked: boolean) => void;
}>) {
  const id = useId();
  const { request, state, run, pending } = useFactAction(saveCompanyFactAction);
  const [verified, setVerified] = useState(fact === null);
  const failed = state.status !== "idle" && !COMPANY_FACT_FORM_GOOD.has(state.status);
  const created = fact === null;
  const saved = state.status === "saved" || state.status === "unchanged";

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        onLockedChange?.(true);
        startTransition(async () => { await run(form); onLockedChange?.(false); });
      }}
      aria-busy={pending}
      className="grid gap-4"
      data-testid={created ? "v3-company-fact-form-new" : "v3-company-fact-form"}
    >
      <input type="hidden" name="request_id" value={request} />
      <input type="hidden" name="fact_id" value={fact?.id ?? ""} />
      <input type="hidden" name="mark_verified" value={verified ? "1" : "0"} />
      {created ? (
        <>
          <div>
            <label htmlFor={`${id}-topic`} className={LABEL}>{companyFactWords.topicKey}</label>
            <input id={`${id}-topic`} name="topic" required maxLength={COMPANY_FACT_LIMITS.topicMaxChars} autoComplete="off" spellCheck={false}
              pattern="[a-z0-9]+(\.[a-z0-9_\-]+)+" placeholder="course.sat.group" className={`${QUEUE_FIELD} font-mono`} disabled={saved} />
            <p className="mt-1 t-meta text-fg-3">{companyFactWords.topicKeyHint}</p>
          </div>
          <div>
            <label htmlFor={`${id}-audience`} className={LABEL}>{companyFactWords.audience}</label>
            <NativeSelect id={`${id}-audience`} name="audience" defaultValue="client" disabled={saved}>
              {COMPANY_FACT_AUDIENCES.map((value) => <option key={value} value={value}>{COMPANY_FACT_AUDIENCE_WORD[value]}. {COMPANY_FACT_AUDIENCE_HINT[value]}</option>)}
            </NativeSelect>
          </div>
        </>
      ) : (
        <div>
          <p className="font-medium text-fg [overflow-wrap:anywhere]">{companyFactTopicTitle(fact.topic)}</p>
          <p className="t-meta text-fg-3 [overflow-wrap:anywhere]">{fact.topic} · {COMPANY_FACT_AUDIENCE_WORD[fact.audience]}</p>
        </div>
      )}
      <div>
        <label htmlFor={`${id}-ru`} className={LABEL}>{companyFactWords.statementRu}</label>
        <Textarea id={`${id}-ru`} name="statement_ru" required maxLength={COMPANY_FACT_LIMITS.statementMaxChars} rows={6} defaultValue={fact?.statementRu ?? ""}
          disabled={saved} onChange={() => setVerified(true)} />
      </div>
      <div>
        <label htmlFor={`${id}-ky`} className={LABEL}>{companyFactWords.statementKy}</label>
        <Textarea id={`${id}-ky`} name="statement_ky" maxLength={COMPANY_FACT_LIMITS.statementMaxChars} rows={3} defaultValue={fact?.statementKy ?? ""}
          disabled={saved} onChange={() => setVerified(true)} />
      </div>
      <div>
        <label htmlFor={`${id}-en`} className={LABEL}>{companyFactWords.statementEn}</label>
        <Textarea id={`${id}-en`} name="statement_en" maxLength={COMPANY_FACT_LIMITS.statementMaxChars} rows={3} defaultValue={fact?.statementEn ?? ""}
          disabled={saved} onChange={() => setVerified(true)} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={`${id}-source`} className={LABEL}>{companyFactWords.source}</label>
          <NativeSelect id={`${id}-source`} name="source" defaultValue={fact?.source ?? "owner"} disabled={saved}>
            {COMPANY_FACT_SOURCES.map((value) => <option key={value} value={value}>{COMPANY_FACT_SOURCE_WORD[value]}</option>)}
          </NativeSelect>
        </div>
        <div>
          <label htmlFor={`${id}-until`} className={LABEL}>{companyFactWords.validUntil}</label>
          <input id={`${id}-until`} name="valid_until" type="date" defaultValue={fact?.validUntil ?? ""} className={QUEUE_FIELD} disabled={saved} />
          <p className="mt-1 t-meta text-fg-3">Пусто: без срока. После этой даты агенты факт не видят.</p>
        </div>
      </div>
      <div>
        <label htmlFor={`${id}-ref`} className={LABEL}>{companyFactWords.sourceRef}</label>
        <input id={`${id}-ref`} name="source_ref" maxLength={COMPANY_FACT_LIMITS.sourceRefMaxChars} defaultValue={fact?.sourceRef ?? ""} className={QUEUE_FIELD} disabled={saved} />
      </div>
      <label className="flex min-h-11 items-start gap-3 t-body text-fg">
        <Checkbox checked={verified} onCheckedChange={(value) => setVerified(value === true)} disabled={saved || created} className="mt-0.5" />
        <span>{created ? companyFactWords.verifyCheckboxCreate : companyFactWords.verifyCheckbox}</span>
      </label>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {saved ? (
          <button type="button" className={QUEUE_CONFIRM} onClick={onDone}>Готово</button>
        ) : (
          <button type="submit" className={QUEUE_CONFIRM} disabled={pending}>{pending ? "Сохраняем…" : "Сохранить"}</button>
        )}
        <p role={failed ? "alert" : "status"} className={`t-body-compact ${failed ? "text-danger" : "text-fg-2"}`}>{COMPANY_FACT_FORM_MESSAGE[state.status]}</p>
      </div>
    </form>
  );
}

/** «Проверено»: тот же текст и срок, новая версия с сегодняшней датой проверки и вами как проверяющим. */
export function CompanyFactVerifyButton({ fact }: Readonly<{ fact: CompanyFact }>) {
  const { request, state, run, pending } = useFactAction(saveCompanyFactAction);
  const failed = state.status !== "idle" && !COMPANY_FACT_FORM_GOOD.has(state.status);
  return (
    <form
      onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); startTransition(() => run(form)); }}
      aria-busy={pending} className="grid gap-1" data-testid="v3-company-fact-verify"
    >
      <input type="hidden" name="request_id" value={request} />
      <input type="hidden" name="fact_id" value={fact.id} />
      <input type="hidden" name="topic" value="" />
      <input type="hidden" name="audience" value="" />
      <input type="hidden" name="statement_ru" value={fact.statementRu} />
      <input type="hidden" name="statement_ky" value={fact.statementKy ?? ""} />
      <input type="hidden" name="statement_en" value={fact.statementEn ?? ""} />
      <input type="hidden" name="source" value={fact.source} />
      <input type="hidden" name="source_ref" value={fact.sourceRef ?? ""} />
      <input type="hidden" name="valid_until" value={fact.validUntil ?? ""} />
      <input type="hidden" name="mark_verified" value="1" />
      <button type="submit" className={QUEUE_SECONDARY} disabled={pending} aria-label={`${companyFactWords.verify}: ${companyFactTopicTitle(fact.topic)}`}>
        {pending ? "…" : companyFactWords.verify}
      </button>
      {state.status !== "idle" ? <p role={failed ? "alert" : "status"} className={`t-meta ${failed ? "text-danger" : "text-fg-3"}`}>{COMPANY_FACT_FORM_MESSAGE[state.status]}</p> : null}
    </form>
  );
}

/** «Снять»: факт перестаёт быть виден агентам; запись остаётся в истории. Нужно подтверждение. */
export function CompanyFactRetire({ fact, onDone, onLockedChange }: Readonly<{ fact: CompanyFact; onDone?: () => void; onLockedChange?: (locked: boolean) => void }>) {
  const { request, state, run, pending } = useFactAction(retireCompanyFactAction);
  const [confirming, setConfirming] = useState(false);
  const failed = state.status !== "idle" && !COMPANY_FACT_FORM_GOOD.has(state.status);
  if (state.status === "retired") {
    return (
      <div className="flex flex-wrap items-center gap-3" data-testid="v3-company-fact-retired">
        <p role="status" className="t-body-compact text-fg-2">{COMPANY_FACT_FORM_MESSAGE.retired}</p>
        <button type="button" className={QUEUE_SECONDARY} onClick={onDone}>Готово</button>
      </div>
    );
  }
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        onLockedChange?.(true);
        startTransition(async () => { await run(form); onLockedChange?.(false); });
      }}
      aria-busy={pending} className="grid gap-2" data-testid="v3-company-fact-retire"
    >
      <input type="hidden" name="request_id" value={request} />
      <input type="hidden" name="fact_id" value={fact.id} />
      <p className="t-meta text-fg-3">{companyFactWords.retireHint}</p>
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" className={QUEUE_CONFIRM} disabled={pending}>{pending ? "Снимаем…" : "Да, снять факт"}</button>
          <button type="button" className={QUEUE_SECONDARY} disabled={pending} onClick={() => setConfirming(false)}>Отмена</button>
        </div>
      ) : (
        <div><button type="button" className={QUEUE_SECONDARY} onClick={() => setConfirming(true)}>{companyFactWords.retire}</button></div>
      )}
      {state.status !== "idle" ? <p role={failed ? "alert" : "status"} className={`t-body-compact ${failed ? "text-danger" : "text-fg-2"}`}>{COMPANY_FACT_FORM_MESSAGE[state.status]}</p> : null}
    </form>
  );
}
