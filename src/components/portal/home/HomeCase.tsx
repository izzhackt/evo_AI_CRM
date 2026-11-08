import { IntentPrefetchLink } from "@/components/IntentPrefetchLink";

import type { Locale } from "@/lib/i18n-data";
import { formatPortalString, getPortalStrings, type PortalStrings } from "@/lib/portal/i18n";
import type { StudentPortalAction, StudentPortalOverview } from "@/lib/v3/portal-source";

import { formatPortalMoney, studentActionDueLabel } from "../admission/presentation";
import { HomeCardHead, HomeEmpty } from "./HomeParts";

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

/**
 * «Что сделать сейчас» на «Главной» клиента (assisted): ближайшее действие дела — та же модель E2, что у «Моего
 * поступления». 08.11.2026 (по образцу пользователя): шапка карточки, спокойное пустое состояние со значком и строка
 * внизу о том, откуда берутся действия. Сбой чтения — честная плашка без строки внизу.
 */
export function HomeCase({ overview, failed, locale }: Readonly<{
  /** `null` — RPC вернул пустой обзор (дело без плана). */
  overview: StudentPortalOverview | null;
  failed: boolean;
  locale: Locale;
}>) {
  const strings = getPortalStrings("home", locale);
  const admission = getPortalStrings("admission", locale);
  const primary = overview?.studentAction ?? null;
  const remaining = overview ? overview.studentActions.length - 1 : 0;
  const primaryDue = primary ? studentActionDueLabel(primary) : null;

  return (
    <section aria-labelledby="home-case" className="pt-card pt-home-box pt-home-case">
      <HomeCardHead id="home-case" title={strings.caseHeading} />
      {failed ? (
        <p role="alert" className="pt-alert">{strings.caseUnavailable}</p>
      ) : primary ? (
        <div className="pt-home-case-body">
          <h3 className="pt-home-case-title">{actionTitle(primary, admission)}</h3>
          {/* Срок и сумма — только когда они есть: «Срок: не указан» ничего не сообщает. */}
          {(primaryDue && primary.dueAt) || primary.kind === "payment" ? (
            <dl className="pt-home-case-facts">
              {primaryDue && primary.dueAt ? (
                <div className="pt-home-case-fact">
                  <dt>{admission.dueTerm}</dt>
                  <dd><time dateTime={primary.dueAt}>{primaryDue}</time></dd>
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
            {remaining > 0 ? (
              <IntentPrefetchLink href="/portal" className="pt-link pt-home-case-more">
                {formatPortalString(strings.caseMore, { count: String(remaining) })}
              </IntentPrefetchLink>
            ) : null}
          </div>
        </div>
      ) : (
        <HomeEmpty icon="todo" title={overview ? admission.calmDone : admission.calmNoPlan} />
      )}
      {failed ? null : <p className="pt-home-foot">{strings.caseFoot}</p>}
    </section>
  );
}
