"use client";
import { useActionState, useState } from "react";
import { btnGhostCls, inputCls } from "@/components/ui";
import { LEAD_CHANNELS, leadChannelText, type LeadChannel, type LeadChannelCorrectionState } from "@/lib/lead-channel-contract";
import { correctLeadChannelAction } from "@/lib/platform-lead-channel-actions";

const MESSAGES: Record<LeadChannelCorrectionState["status"], string> = {
  idle: "",
  saved: "",
  invalid: "Выберите канал из списка.",
  forbidden: "Нет права менять этот лид. Обновите страницу после проверки доступа.",
  request_conflict: "Этот запрос уже использован с другим выбором. Выберите ещё раз.",
  unavailable: "Результат пока неизвестен. Повторите то же действие.",
};

/**
 * Исправление «Откуда узнал» (`staff_correction`): тихое раскрытие рядом с самим фактом, без красной
 * кнопки. Текущее значение выбрано заранее, «Сохранить» ждёт другого выбора. Новый выбор — новый id
 * запроса; повтор того же — тот же (идемпотентность 264).
 */
export function LeadChannelCorrection({ leadId, requestId, current }: Readonly<{ leadId: string; requestId: string; current: LeadChannel }>) {
  const [currentRequestId, setCurrentRequestId] = useState(requestId);
  const [choice, setChoice] = useState<LeadChannel>(current);
  const [state, action, pending] = useActionState(async (previous: LeadChannelCorrectionState, form: FormData): Promise<LeadChannelCorrectionState> => {
    try {
      const result = await correctLeadChannelAction(previous, form);
      if (result.status === "saved") setCurrentRequestId(crypto.randomUUID());
      return result;
    } catch { return { ...previous, status: "unavailable" }; }
  }, { status: "idle", requestId, read: null } as LeadChannelCorrectionState);
  const saved = state.status === "saved" ? state.read : null;
  return (
    <details className="group">
      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center t-label text-fg-2 underline underline-offset-4 hover:text-fg [&::-webkit-details-marker]:hidden">
        Исправить
      </summary>
      <form action={action} className="flex flex-wrap items-end gap-2 pb-2" aria-busy={pending}>
        <input type="hidden" name="request_id" value={currentRequestId} />
        <input type="hidden" name="lead_id" value={leadId} />
        <label className="min-w-0 flex-1 basis-56">
          <span className="sr-only">Откуда узнал</span>
          <select name="channel" value={choice} disabled={pending} className={inputCls}
            onChange={(event) => { setChoice(event.currentTarget.value as LeadChannel); setCurrentRequestId(crypto.randomUUID()); }}>
            {Object.entries(LEAD_CHANNELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
        <button className={btnGhostCls} disabled={pending || choice === current}>{pending ? "Сохраняем…" : "Сохранить"}</button>
      </form>
      {saved ? <p role="status" className="pb-2 t-body-compact text-fg-2">Сохранено: {leadChannelText(saved)}</p> : null}
      {state.status !== "idle" && state.status !== "saved" ? <p role="alert" className="pb-2 t-body-compact text-fg-2">{MESSAGES[state.status]}</p> : null}
    </details>
  );
}
