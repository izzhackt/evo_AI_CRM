import { IntentPrefetchLink } from "@/components/IntentPrefetchLink";

import type { Locale } from "@/lib/i18n-data";
import { bishkekDay, homeDaysLabel, homeDaysUntil } from "@/lib/portal/home-dates";
import { formatPortalString, getPortalStrings, type PortalStrings } from "@/lib/portal/i18n";
import type { StudentPortalAction, StudentPortalOverview } from "@/lib/v3/portal-source";

import { PortalStatus } from "../admission/PortalStatus";
import { formatPortalMoney, studentActionDueLabel } from "../admission/presentation";
import { HomeCardHead, HomeEmpty, HomeHint, HomeIcon } from "./HomeParts";

type AdmissionStrings = PortalStrings<"admission">;

export function actionTitle(action: StudentPortalAction, strings: AdmissionStrings): string {
  const verb = action.kind === "payment"
    ? strings.actionPayment
    : action.kind === "upload_document"
      ? strings.actionUpload
      : strings.actionReplace;
  return `${verb}: ${action.label}`;
}

export function actionHref(action: StudentPortalAction): string {
  return action.kind === "payment"
    ? "/portal/payments"
    : `/portal/documents#document-${action.documentSlotId}`;
}

/** Сколько дел видно на карточке: первое — кнопкой, следующие строками; остальные — «Ещё действий: N». */
const HOME_CASE_ROWS = 3;

/**
 * Срок дела словом в пилюле статуса кабинета: просрочено — «опасно» (это проблема), сегодня и завтра — «внимание»,
 * дальше — нейтрально. Дни — по календарю Бишкека, как «Ближайшие даты». Срок, прошедший сегодня по часам, —
 * уже «просрочено», как у сервера и страницы «Оплата» (due_at раньше текущего момента).
 */
function DueStatus({ dueAt, today, now, locale }: Readonly<{ dueAt: string; today: string; now: Date; locale: Locale }>) {
  const strings = getPortalStrings("home", locale);
  const days = homeDaysUntil(bishkekDay(dueAt), today);
  const passed = Date.parse(dueAt) < now.getTime();
  if (days >= 0 && passed) return <PortalStatus label={strings.dateOverdueNow} tone="danger" />;
  return (
    <PortalStatus
      label={homeDaysLabel(days, locale, strings)}
      tone={days < 0 ? "danger" : days <= 1 ? "warn" : "neutral"}
    />
  );
}

/**
 * «Что сделать сейчас» на «Главной» клиента (assisted): ближайшее действие дела — та же модель E2, что у «Моего
 * поступления». 08.11.2026 (по образцу пользователя): шапка карточки и спокойное пустое состояние со значком.
 * 18.11.2026: красная кнопка только у первого дела, следующие два — строками; пояснение «откуда действия» — за «?» в
 * шапке, рядом с заголовком — число дел. У каждого дела значок по виду (документ или оплата; у первого — красноватая
 * плитка, как значки пустых состояний) и срок словом: «через 5 дней», «завтра», «просрочено на 3 дня». Образец
 * документа рядом с делом пробовали и сняли (пользователь, 18.11.2026). Сбой чтения — честная плашка без пояснения.
 */
export function HomeCase({ overview, failed, today, now, locale }: Readonly<{
  /** `null` — RPC вернул пустой обзор (дело без плана). */
  overview: StudentPortalOverview | null;
  failed: boolean;
  /** Сегодня по Бишкеку (YYYY-MM-DD): от него считается «через N дней». */
  today: string;
  /** Момент запроса: срок, прошедший сегодня по часам, — уже «просрочено». */
  now: Date;
  locale: Locale;
}>) {
  const strings = getPortalStrings("home", locale);
  const admission = getPortalStrings("admission", locale);
  const primary = overview?.studentAction ?? null;
  const next = overview ? overview.studentActions.slice(1, HOME_CASE_ROWS) : [];
  const remaining = overview ? Math.max(0, overview.studentActions.length - HOME_CASE_ROWS) : 0;
  const primaryDue = primary ? studentActionDueLabel(primary) : null;

  return (
    <section aria-labelledby="home-case" className="pt-card pt-home-box pt-home-case">
      <HomeCardHead
        id="home-case"
        title={strings.caseHeading}
        count={failed ? null : overview?.studentActions.length ?? null}
        action={failed ? null : <HomeHint label={strings.caseHint} text={strings.caseFoot} />}
      />
      {failed ? (
        <p role="alert" className="pt-alert">{strings.caseUnavailable}</p>
      ) : primary ? (
        <div className="pt-home-case-body">
          <span className="pt-home-case-icon" aria-hidden="true">
            <HomeIcon name={primary.kind === "payment" ? "payments" : "documents"} />
          </span>
          <div className="pt-home-case-main">
            <h3 className="pt-home-case-title">{actionTitle(primary, admission)}</h3>
            {/* Срок и сумма — только когда они есть: «Срок: не указан» ничего не сообщает. */}
            {(primaryDue && primary.dueAt) || primary.kind === "payment" ? (
              <dl className="pt-home-case-facts">
                {primaryDue && primary.dueAt ? (
                  <div className="pt-home-case-fact">
                    <dt>{admission.dueTerm}</dt>
                    <dd>
                      <time dateTime={primary.dueAt}>{primaryDue}</time>
                      <DueStatus dueAt={primary.dueAt} today={today} now={now} locale={locale} />
                    </dd>
                  </div>
                ) : null}
                {primary.kind === "payment" ? (
                  <div className="pt-home-case-fact">
                    <dt>{admission.amountTerm}</dt>
                    <dd className="pt-data">{formatPortalMoney(primary.amountMinor, primary.currency)}</dd>
                  </div>
                ) : null}
              </dl>
            ) : null}
            <div className="pt-home-case-actions">
              <IntentPrefetchLink href={actionHref(primary)} className="pt-btn">
                {primary.kind === "payment" ? admission.openPayment : admission.openDocument}
              </IntentPrefetchLink>
            </div>
          </div>
        </div>
      ) : (
        <HomeEmpty icon="todo" title={overview ? admission.calmDone : admission.calmNoPlan} />
      )}
      {!failed && (next.length > 0 || remaining > 0) ? (
        <div className="pt-home-case-rest">
          {next.length > 0 ? (
            <ul className="pt-home-case-next">
              {next.map((action, index) => {
                const due = action.dueAt ? studentActionDueLabel(action) : null;
                return (
                  // У двух траншей могут совпасть подпись и срок: ключ оплаты — её место в списке.
                  <li key={action.kind === "payment" ? `payment-${index}` : action.documentSlotId}>
                    <IntentPrefetchLink href={actionHref(action)} className="pt-home-case-row">
                      <span className="pt-home-case-row-icon" aria-hidden="true">
                        <HomeIcon name={action.kind === "payment" ? "payments" : "documents"} />
                      </span>
                      <span className="pt-home-case-row-title">{actionTitle(action, admission)}</span>
                      {due && action.dueAt ? (
                        <span className="pt-home-case-row-due">
                          {/* Дата словами видна в пилюле; точный день — для читалки. */}
                          <span className="pt-sr-only">{admission.dueTerm} <time dateTime={action.dueAt}>{due}</time>, </span>
                          <DueStatus dueAt={action.dueAt} today={today} now={now} locale={locale} />
                        </span>
                      ) : null}
                    </IntentPrefetchLink>
                  </li>
                );
              })}
            </ul>
          ) : null}
          {remaining > 0 ? (
            <IntentPrefetchLink href="/portal/documents" className="pt-link pt-home-case-more">
              {formatPortalString(strings.caseMore, { count: String(remaining) })}
            </IntentPrefetchLink>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
