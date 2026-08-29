"use client";

import { useActionState } from "react";

import { btnCls, cn } from "@/components/ui";
import type { Locale } from "@/lib/i18n";
import type { CanonicalWahaPreflightAvailability } from "@/lib/server/canonical-waha-preflight";
import {
  runCanonicalWahaPreflightAction,
  type CanonicalWahaPreflightActionState,
} from "@/lib/server/canonical-waha-preflight-actions";

const INITIAL_CANONICAL_WAHA_PREFLIGHT_ACTION_STATE =
  Object.freeze<CanonicalWahaPreflightActionState>({
    status: "idle",
    reason: null,
    checkedAt: null,
    sessionName: null,
  });

const COPY = {
  ru: {
    title: "WAHA preflight · только read-only проверка сессии",
    description:
      "Эта панель показывает только безопасный статус private WAHA session. Она не запускает QR, restart, logout, send или любые другие mutating команды.",
    configured: "Конфигурация готова. Для свежего статуса нужен отдельный read-only запрос.",
    blocked: "Read-only preflight заблокирован настройками этого контура.",
    check: "Запросить свежую проверку",
    pending: "Проверяем private session…",
    result: "Результат последней проверки",
    checkedAt: "Проверено",
    working: "Сессия подтверждена как WORKING.",
    notWorking: "Сессия не подтверждена как WORKING.",
    invalid: "Запрос отклонён: invalid preflight request identifier.",
    feature_disabled: "Функция WAHA preflight выключена.",
    provider_not_authorized:
      "Отдельное разрешение на реальный read-only запрос к WAHA не выдано.",
    configuration_missing: "Не хватает server-only base URL, API key или exact session name.",
    configuration_invalid: "Настройки WAHA preflight некорректны.",
    provider_unreachable: "WAHA недоступен или не ответил в bounded timeout.",
    provider_rejected: "WAHA отклонил запрос или вернул не-OK HTTP статус.",
    provider_malformed_response: "WAHA вернул небезопасный или malformed response.",
    session_name_mismatch: "WAHA вернул ответ не для exact configured session.",
    session_not_working: "Статус exact configured session не равен WORKING.",
  },
  ky: {
    title: "WAHA preflight · read-only сессия текшерүүсү гана",
    description:
      "Бул панель private WAHA session'дун коопсуз статусун гана көрсөтөт. Ал QR, restart, logout, send же башка mutating буйруктарды иштетпейт.",
    configured:
      "Конфигурация даяр. Жаңы статус үчүн өзүнчө read-only суроо керек.",
    blocked: "Read-only preflight ушул контурдун жөндөөлөрү менен бөгөттөлгөн.",
    check: "Жаңы текшерүү суратуу",
    pending: "Private session текшерилип жатат…",
    result: "Акыркы текшерүүнүн жыйынтыгы",
    checkedAt: "Текшерилген убакыт",
    working: "Сессия WORKING катары тастыкталды.",
    notWorking: "Сессия WORKING катары тастыкталган жок.",
    invalid: "Суроо четке кагылды: preflight request identifier жараксыз.",
    feature_disabled: "WAHA preflight функциясы өчүрүлгөн.",
    provider_not_authorized:
      "WAHA'га чыныгы read-only суроо үчүн өзүнчө уруксат берилген жок.",
    configuration_missing:
      "Server-only base URL, API key же так session name жетишпейт.",
    configuration_invalid: "WAHA preflight жөндөөлөрү туура эмес.",
    provider_unreachable:
      "WAHA жеткиликсиз болду же bounded timeout ичинде жооп берген жок.",
    provider_rejected: "WAHA суроону четке какты же non-OK HTTP status кайтарды.",
    provider_malformed_response: "WAHA коопсуз эмес же malformed response кайтарды.",
    session_name_mismatch: "WAHA exact configured session үчүн эмес жооп кайтарды.",
    session_not_working: "Exact configured session'дун статусу WORKING эмес.",
  },
  en: {
    title: "WAHA preflight · read-only session check only",
    description:
      "This panel shows only the safe status of the private WAHA session. It does not start QR, restart, logout, send, or any other mutating command.",
    configured:
      "Configuration is present. A separate read-only request is required for fresh status.",
    blocked: "The read-only preflight is blocked by this environment's settings.",
    check: "Request fresh check",
    pending: "Checking private session…",
    result: "Latest preflight result",
    checkedAt: "Checked at",
    working: "The session was confirmed as WORKING.",
    notWorking: "The session was not confirmed as WORKING.",
    invalid: "The request was rejected because the preflight request identifier is invalid.",
    feature_disabled: "The WAHA preflight feature is disabled.",
    provider_not_authorized:
      "A separate authorization for a real read-only WAHA request was not granted.",
    configuration_missing:
      "The server-only base URL, API key, or exact session name is missing.",
    configuration_invalid: "The WAHA preflight configuration is invalid.",
    provider_unreachable:
      "WAHA was unreachable or did not reply within the bounded timeout.",
    provider_rejected: "WAHA rejected the request or returned a non-OK HTTP status.",
    provider_malformed_response: "WAHA returned an unsafe or malformed response.",
    session_name_mismatch:
      "WAHA returned a response for a different session than the exact configured one.",
    session_not_working:
      "The exact configured session status was not WORKING.",
  },
} as const;

function reasonText(locale: Locale, reason: string | null): string {
  const copy = COPY[locale];
  if (
    reason === "feature_disabled" ||
    reason === "provider_not_authorized" ||
    reason === "configuration_missing" ||
    reason === "configuration_invalid" ||
    reason === "provider_unreachable" ||
    reason === "provider_rejected" ||
    reason === "provider_malformed_response" ||
    reason === "session_name_mismatch" ||
    reason === "session_not_working"
  ) {
    return copy[reason];
  }
  return copy.invalid;
}

export function CanonicalWahaPreflightPanel({
  locale,
  availability,
  requestId,
}: Readonly<{
  locale: Locale;
  availability: CanonicalWahaPreflightAvailability;
  requestId: string;
}>) {
  const copy = COPY[locale];
  const [state, action, pending] = useActionState(
    runCanonicalWahaPreflightAction,
    INITIAL_CANONICAL_WAHA_PREFLIGHT_ACTION_STATE,
  );

  return (
    <section
      className="space-y-3 rounded-card border border-border bg-surface-2 p-4"
      data-testid="canonical-waha-preflight-panel"
    >
      <div>
        <h3 className="text-[15px] font-semibold text-fg">{copy.title}</h3>
        <p className="mt-1 text-[13px] leading-6 text-fg-3">{copy.description}</p>
      </div>

      <div
        className={cn(
          "rounded-control border px-3 py-2 text-[13px]",
          availability.status === "configured"
            ? "border-info/30 bg-info-weak text-info"
            : "border-warn/30 bg-warn-weak text-warn",
        )}
        data-testid="canonical-waha-preflight-availability"
        data-status={availability.status}
        data-reason={availability.status === "blocked" ? availability.reason : undefined}
        data-session-name={
          availability.status === "configured" ? availability.sessionName : undefined
        }
      >
        {availability.status === "configured"
          ? `${availability.sessionName} · ${copy.configured}`
          : `${copy.blocked} ${reasonText(locale, availability.reason)}`}
      </div>

      {availability.status === "configured" ? (
        <form action={action} data-testid="canonical-waha-preflight-form">
          <input
            type="hidden"
            name="preflight_request_id"
            value={requestId}
            data-testid="canonical-waha-preflight-request-id"
          />
          <button
            type="submit"
            className={btnCls}
            disabled={pending}
            data-testid="canonical-waha-preflight-submit"
          >
            {pending ? copy.pending : copy.check}
          </button>
        </form>
      ) : null}

      {state.status !== "idle" ? (
        <div
          className={cn(
            "space-y-1 rounded-control border px-3 py-3 text-[13px]",
            state.status === "working"
              ? "border-success/30 bg-success-weak text-success"
              : state.status === "not-working"
                ? "border-warn/30 bg-warn-weak text-warn"
                : "border-danger/30 bg-danger-weak text-danger",
          )}
          data-testid="canonical-waha-preflight-result"
          data-status={state.status}
          data-reason={state.reason ?? undefined}
          data-checked-at={state.checkedAt ?? undefined}
          data-session-name={state.sessionName ?? undefined}
        >
          <p className="font-medium text-current">{copy.result}</p>
          <p>
            {state.status === "working"
              ? copy.working
              : state.status === "not-working"
                ? `${copy.notWorking} ${reasonText(locale, state.reason)}`
                : state.status === "blocked"
                  ? `${copy.blocked} ${reasonText(locale, state.reason)}`
                  : copy.invalid}
          </p>
          {state.checkedAt ? (
            <p className="text-[12px] text-current/90">
              {copy.checkedAt}:{" "}
              <time dateTime={state.checkedAt}>{state.checkedAt}</time>
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
