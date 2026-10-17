"use client";

import { useRouter } from "next/navigation";
import { startTransition, useActionState, useEffect, useId, useRef, useState, type FormEvent } from "react";

import { ADMISSIONS_DIRECTIONS, type AdmissionsDirection } from "@/lib/platform-admissions-playbook-contract";
import { setCaseDirectionAction, type CaseDirectionActionState } from "@/lib/platform-case-direction-actions";
import { caseDirectionOptionNote, caseDirectionWords } from "@/lib/v3/wording";

import { QUEUE_CONFIRM, QUEUE_FIELD, QUEUE_SECONDARY } from "../queue/queue-buttons";
import { DIRECTION_LABELS } from "./admissions-view";

/** Текстовая кнопка факта: 44 px по высоте, подчёркнута - без красного она остаётся действием. */
const FACT_ACTION = "inline-flex min-h-11 items-center t-label text-fg-2 underline underline-offset-4 hover:text-fg";

/**
 * Значение строки «Направление» в «Сведениях» дела и, для того, кто назначает
 * кураторов (Admin и руководитель поступления, `case.curator.assign`), действие
 * «Задать направление» (пусто) или «Сменить» (задано). Форма раскрывается под
 * значением: один выбор из пяти направлений сотрудников и «Сохранить». Запись
 * идёт на `useActionState` с версией дела и идентификатором запроса; «сохранено»
 * - только по расписке сервера, ошибки - словами `wording.ts`. Права и версию
 * проверяет сервер: здесь только подсказка, кому действие показывать.
 */
export function CaseDirection({
  studentCaseId,
  current,
  expectedVersion,
  requestId,
}: Readonly<{
  studentCaseId: string;
  /** Направление дела; null - «Не выбрано». */
  current: AdmissionsDirection | null;
  /** `admissions_version` дела из строки очереди: ожидаемая версия записи. */
  expectedVersion: string;
  requestId: string;
}>) {
  const router = useRouter();
  const fieldId = useId();
  const selectRef = useRef<HTMLSelectElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string>(current ?? "");
  const [state, action, pending] = useActionState<CaseDirectionActionState, FormData>(
    setCaseDirectionAction,
    { status: "idle", requestId, message: null, receipt: null },
  );
  // Ответ, сообщение которого человек уже увидел и снял (открыл форму заново или нажал «Обновить»).
  const [seen, setSeen] = useState<CaseDirectionActionState | null>(null);
  const fresh = state !== seen;
  const done = fresh && (state.status === "saved" || state.status === "unchanged");
  const failed = fresh && state.status !== "idle" && !done;
  // Конфликт версии: пока дело не перечитано, записать нечем - чужая версия победит снова.
  const stale = fresh && state.status === "stale";

  // Расписка пришла: форма закрывается, значение берётся из перечитанной страницы.
  if (open && done) setOpen(false);

  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      selectRef.current?.focus();
    } else if (wasOpen.current) {
      // Форма закрылась (отмена или расписка): фокус возвращается на кнопку, а не падает на страницу.
      wasOpen.current = false;
      triggerRef.current?.focus();
    }
  }, [open]);

  const label = current ? DIRECTION_LABELS[current] : null;
  const dirty = selected !== "" && selected !== (current ?? "");

  // Не `<form action>`: React 19 после ответа сбрасывает поля формы к начальным, а управляемый выбор остался бы
  // в состоянии с прежним значением на экране. Отправка вручную сохраняет выбор человека при отказе сервера.
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !dirty || stale) return;
    const data = new FormData(event.currentTarget);
    startTransition(() => action(data));
  }

  return (
    <div className="min-w-0" data-testid="v3-case-direction">
      <p className="flex min-w-0 flex-wrap items-baseline gap-x-3">
        <span data-testid="v3-case-direction-value">{label ?? "Не выбрано"}</span>
        {!open ? (
          <button
            ref={triggerRef}
            type="button"
            className={FACT_ACTION}
            onClick={() => { setSelected(current ?? ""); setSeen(state); setOpen(true); }}
          >
            {current ? (
              <>{caseDirectionWords.change}<span className="sr-only">{caseDirectionWords.changeObject}</span></>
            ) : caseDirectionWords.set}
          </button>
        ) : null}
      </p>
      {open ? (
        <form onSubmit={submit} aria-busy={pending} className="mt-1 space-y-3" data-testid="v3-case-direction-form">
          <input type="hidden" name="student_case_id" value={studentCaseId} />
          <input type="hidden" name="expected_version" value={expectedVersion} />
          <input type="hidden" name="request_id" value={state.requestId} />
          <div>
            {/* Название поля уже сказано строкой «Направление» над формой: для глаза не повторяется, для чтения с экрана остаётся. */}
            <label htmlFor={fieldId} className="sr-only">{caseDirectionWords.field}</label>
            <select
              ref={selectRef}
              id={fieldId}
              name="direction"
              value={selected}
              disabled={pending}
              onChange={(event) => setSelected(event.target.value)}
              aria-invalid={failed ? true : undefined}
              className={QUEUE_FIELD}
            >
              <option value="" disabled>{caseDirectionWords.choose}</option>
              {ADMISSIONS_DIRECTIONS.map((direction) => {
                const note = caseDirectionOptionNote(direction);
                return <option key={direction} value={direction}>{DIRECTION_LABELS[direction]}{note ? ` (${note})` : ""}</option>;
              })}
            </select>
          </div>
          {failed && state.message ? (
            <p role="alert" className="t-body-compact text-danger">{state.message}</p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {stale ? (
              <button type="button" className={QUEUE_CONFIRM} onClick={() => { setSeen(state); router.refresh(); }}>
                {caseDirectionWords.refresh}
              </button>
            ) : null}
            <button type="submit" disabled={pending || !dirty || stale} className={stale ? QUEUE_SECONDARY : QUEUE_CONFIRM}>
              {pending ? caseDirectionWords.saving : caseDirectionWords.save}
            </button>
            <button type="button" disabled={pending} className={QUEUE_SECONDARY} onClick={() => setOpen(false)}>
              {caseDirectionWords.cancel}
            </button>
          </div>
        </form>
      ) : done && state.message ? (
        <p role="status" className="t-body-compact text-ok">{state.message}</p>
      ) : null}
    </div>
  );
}
