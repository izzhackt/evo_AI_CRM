"use client";
import { unstable_rethrow, useRouter } from "next/navigation";
import { startTransition, useActionState, useRef } from "react";

import { mutateCatalogGeographyAction, type GeographyActionState, type GeographyActionStatus, type GeographyOperation } from "@/lib/catalog-geography-actions";

/*
 * Общие части редактора географии и стоимости (план 7.5): команда RPC с
 * безопасным повтором, слова итога и классы полей. Облик Э1.5: белый лист,
 * волосяные рамки, поля `inputCls`, подписи `t-label`; сплошной красный только
 * у главного действия страницы.
 */
export const FIELD = "mt-1 h-11 w-full min-w-0 rounded-ctl border border-control-edge bg-surface px-3 t-body-compact text-fg placeholder:text-fg-3 hover:bg-surface-2 focus-visible:border-accent [&[readonly]]:bg-surface-2 [&[readonly]]:text-fg-2 aria-[invalid=true]:border-danger disabled:opacity-60";
export const AREA = "mt-1 min-h-20 w-full min-w-0 rounded-ctl border border-control-edge bg-surface px-3 py-2 t-body-compact text-fg placeholder:text-fg-3 hover:bg-surface-2 focus-visible:border-accent aria-[invalid=true]:border-danger disabled:opacity-60";
export const LABEL = "block t-label text-fg-2";
export const GHOST = "v3-raised inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-ctl border border-control-edge bg-surface px-3 t-label text-fg-2 hover:bg-surface-2 hover:text-fg disabled:cursor-not-allowed disabled:opacity-50";
export const PRIMARY = "v3-raised inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-ctl border border-accent bg-accent px-4 t-label text-on-accent hover:border-accent-2 hover:bg-accent-2 disabled:cursor-not-allowed disabled:opacity-50";
/** Подтверждение в панели: тёмная нейтральная кнопка (сплошной красный на странице один). */
export const DARK = "v3-raised inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-ctl border border-fg bg-fg px-4 t-label text-surface hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";
export const QUIET = "inline-flex min-h-11 items-center gap-1.5 t-label text-fg-2 underline underline-offset-4 hover:text-fg disabled:cursor-not-allowed disabled:opacity-50 disabled:no-underline";

export const GEOGRAPHY_MESSAGES: Readonly<Record<Exclude<GeographyActionStatus, "idle" | "saved">, string>> = {
  invalid: "Сервер не принял данные. Проверьте поля, ссылки HTTPS и даты: ничего не сохранено.",
  forbidden: "Нет права на это действие. Обновите страницу или войдите снова.",
  stale: "Запись уже изменили. Обновите страницу и повторите с актуальной версией.",
  request_conflict: "Этот запрос уже использован с другими данными. Обновите страницу перед новой попыткой.",
  rejected: "База отклонила изменение: строку агентства нельзя опубликовать без подтверждения, а опубликованная карточка города должна остаться полной.",
  unavailable: "Ответ сервера не подтверждён. Повторите: тот же запрос не создаст дубликат.",
};

/**
 * Команда одной формы. Повтор после неподтверждённого ответа идёт с тем же
 * `request_id` и тем же входом (RPC вернёт ту же квитанцию); любой новый ввод
 * или определённый итог получает новый `request_id`.
 */
export function useGeographyCommand(operation: GeographyOperation) {
  const router = useRouter();
  const last = useRef<{ payload: string; requestId: string } | null>(null);
  const [state, dispatch, pending] = useActionState(async (previous: GeographyActionState, payload: string): Promise<GeographyActionState> => {
    const retry = previous.status === "unavailable" && last.current?.payload === payload;
    const requestId = retry && last.current ? last.current.requestId : crypto.randomUUID();
    last.current = { payload, requestId };
    const form = new FormData();
    form.set("operation", operation);
    form.set("request_id", requestId);
    form.set("payload", payload);
    try {
      return await mutateCatalogGeographyAction({ ...previous, requestId, operation }, form);
    } catch (error) {
      unstable_rethrow(error);
      return { status: "unavailable", requestId, operation };
    }
  }, { status: "idle", requestId: "", operation });
  const run = (payload: unknown) => startTransition(() => dispatch(JSON.stringify(payload)));
  const refresh = () => router.refresh();
  return { state, run, pending, refresh };
}

/** Итог команды словами; ошибка у «stale» и «request_conflict» даёт «Обновить страницу». */
export function CommandResult({ state, saved, refresh }: Readonly<{ state: GeographyActionState; saved?: string; refresh: () => void }>) {
  if (state.status === "idle") return null;
  if (state.status === "saved") return saved ? <p role="status" className="t-body-compact text-ok">{saved}</p> : null;
  return (
    <p role="alert" className="flex flex-wrap items-center gap-x-3 t-body-compact text-danger">
      {GEOGRAPHY_MESSAGES[state.status]}
      {state.status === "stale" || state.status === "request_conflict" ? <button type="button" className={QUIET} onClick={refresh}>Обновить страницу</button> : null}
    </p>
  );
}

/** После неудачной проверки фокус уходит на первое неверное поле (DESIGN «Добавить студента»). */
export function focusFirstInvalid(form: HTMLFormElement) {
  setTimeout(() => form.querySelector<HTMLElement>("[aria-invalid=\"true\"]")?.focus(), 0);
}

/** Ошибка поля: под полем, словами (DESIGN «Добавить студента»). */
export function FieldError({ id, text }: Readonly<{ id: string; text: string | null }>) {
  return text ? <p id={id} className="mt-1 t-meta text-danger">{text}</p> : null;
}
