import Link from "next/link";

import type { Locale } from "@/lib/i18n-data";
import { getPortalStrings, type PortalStrings } from "@/lib/portal/i18n";

import type { StudentPortalAction, StudentPortalOverview } from "@/lib/v3/portal-source";
import { PortalStatus } from "./PortalStatus";
import { evoActionDueLabel, evoActionStatus, formatPortalMoney, studentActionDueLabel } from "./presentation";

type AdmissionStrings = PortalStrings<"admission">;

function actionTitle(action: StudentPortalAction, strings: AdmissionStrings): string {
  const verb = action.kind === "payment" ? strings.actionPayment : action.kind === "upload_document" ? strings.actionUpload : strings.actionReplace;
  return `${verb}: ${action.label}`;
}

function actionHref(action: StudentPortalAction): string {
  return action.kind === "payment" ? "/portal/payments" : `/portal/documents#document-${action.documentSlotId}`;
}

/** One flat row per queued action: title, due date, amount when relevant, and a direct link. No disclosure. */
function ActionRow({ action, strings }: { action: StudentPortalAction; strings: AdmissionStrings }) {
  const due = studentActionDueLabel(action);
  return (
    <li className="pt-adm-row">
      <div className="pt-adm-row-main">
        <p className="pt-adm-row-title">{actionTitle(action, strings)}</p>
        <dl className="pt-adm-row-meta">
          <div className="pt-adm-row-meta-item">
            <dt>{strings.dueTerm}</dt>
            <dd>{due && action.dueAt ? <time dateTime={action.dueAt}>{due}</time> : strings.dueUnknown}</dd>
          </div>
          {action.kind === "payment" ? (
            <div className="pt-adm-row-meta-item">
              <dt>{strings.amountTerm}</dt>
              <dd className="pt-data">{formatPortalMoney(action.amountMinor, action.currency)}</dd>
            </div>
          ) : null}
        </dl>
      </div>
      <Link href={actionHref(action)} className="pt-btn-ghost pt-adm-row-action">
        {action.kind === "payment" ? strings.openPayment : strings.openDocument} <span aria-hidden="true">↗</span>
      </Link>
    </li>
  );
}

/**
 * Обзор «Моего поступления» в Атласе (PORT-5d): один заметный главный шаг,
 * очередь остальных действий и честная колонка команды EVO. Функциональные
 * контракты прежние: E2 DTO из portal-source, null-семантика 189 сохранена
 * (dueAt: null = «без срока» → «Не указан»). PORT-6a: все строки — из
 * неймспейса admission (RU байт-в-байт прежний, KY полный); словарь
 * pending-кабинета (бывший portalPendingCabinet из wording.ts) живёт здесь
 * же ключами pending* с теми же русскими значениями.
 */
export function OverviewView({ overview, pending = false, locale }: { overview: StudentPortalOverview | null; pending?: boolean; locale: Locale }) {
  const strings = getPortalStrings("admission", locale);
  const primary = overview?.studentAction ?? null;
  const remaining = overview?.studentActions.slice(1) ?? [];
  const evoAction = overview?.evoAction ?? null;
  const evoDue = evoAction ? evoActionDueLabel(evoAction) : null;
  const evoStatus = evoAction ? evoActionStatus(evoAction, strings) : null;

  return (
    <div className="pt-adm-grid">
      <div className="pt-adm-main">
        <section aria-labelledby="student-next-step" className="pt-card">
          <header className="pt-card-header">
            <h2 id="student-next-step" className="pt-card-title">
              {overview ? strings.nextStepHeading : strings.planHeading}
            </h2>
            {primary ? <span className="pt-card-note">{strings.nextStepNote}</span> : null}
          </header>

          {primary ? (
            <div className="pt-adm-hero">
              <div className="pt-adm-hero-head">
                <span aria-hidden="true" className="pt-adm-hero-icon">↗</span>
                <h3 className="pt-adm-hero-title">{actionTitle(primary, strings)}</h3>
              </div>
              <p className="pt-adm-hero-lead">
                {primary.kind === "payment"
                  ? strings.heroPaymentLead
                  : primary.kind === "replace_document"
                    ? strings.heroReplaceLead
                    : strings.heroUploadLead}
              </p>
              <dl className="pt-adm-hero-facts">
                <div className="pt-adm-hero-fact">
                  <dt>{strings.heroDueTerm}</dt>
                  <dd>
                    {studentActionDueLabel(primary) && primary.dueAt ? (
                      <time dateTime={primary.dueAt}>{studentActionDueLabel(primary)}</time>
                    ) : strings.dueUnknown}
                  </dd>
                </div>
                <div className="pt-adm-hero-fact">
                  <dt>{primary.kind === "payment" ? strings.heroOutstandingTerm : strings.heroDocumentTerm}</dt>
                  <dd>
                    {primary.kind === "payment" ? formatPortalMoney(primary.amountMinor, primary.currency) : primary.label}
                  </dd>
                </div>
              </dl>
              <Link href={actionHref(primary)} className="pt-btn pt-adm-hero-cta">
                {primary.kind === "payment" ? strings.heroPaymentCta : strings.openDocument} <span aria-hidden="true">↗</span>
              </Link>
            </div>
          ) : (
            <div className="pt-adm-hero">
              <span aria-hidden="true" className="pt-adm-hero-icon pt-adm-hero-icon-calm">
                {overview ? "✓" : "—"}
              </span>
              <h3 className="pt-adm-hero-title pt-adm-hero-title-calm">
                {overview ? strings.calmDone : strings.calmNoPlan}
              </h3>
              <p className="pt-adm-hero-lead">
                {overview ? strings.calmDoneLead : strings.calmNoPlanLead}
              </p>
              <Link href="/portal/universities" className="pt-link pt-adm-hero-link">
                {strings.exploreUniversities} <span aria-hidden="true">→</span>
              </Link>
            </div>
          )}

          {remaining.length ? (
            <div>
              <h3 className="pt-adm-subhead">
                {strings.remainingHeading}
                <span className="pt-data">{remaining.length}</span>
              </h3>
              <ul className="pt-adm-list">
                {remaining.map((action, index) => (
                  <ActionRow
                    key={action.kind === "payment" ? `${action.kind}:${action.label}:${action.dueAt}:${index}` : action.documentSlotId}
                    action={action}
                    strings={strings}
                  />
                ))}
              </ul>
            </div>
          ) : null}

          <nav aria-label={strings.footerNavAria} className="pt-adm-footer-links">
            <Link href="/portal/documents" className="pt-link">
              {strings.allDocuments} <span aria-hidden="true">↗</span>
            </Link>
            <Link href="/portal/payments" className="pt-link">
              {strings.allPayments} <span aria-hidden="true">↗</span>
            </Link>
          </nav>
        </section>
      </div>

      <aside aria-label={strings.asideAria} className="pt-adm-aside">
        <h2 className="pt-adm-aside-title">{strings.evoHeading}</h2>
        {evoAction && evoStatus ? (
          <div id={`evo-task-${evoAction.taskId}`} className="pt-adm-evo">
            <p className="pt-adm-evo-title">{evoAction.title}</p>
            <div className="pt-adm-evo-meta">
              <PortalStatus label={evoStatus.label} tone={evoStatus.tone} />
              {evoDue ? <span className="pt-adm-evo-due">{strings.dueTerm} {evoDue}</span> : null}
            </div>
          </div>
        ) : (
          <p className="pt-adm-aside-muted">{strings.evoEmpty}</p>
        )}

        <div className="pt-adm-curator">
          <p className="pt-adm-curator-caption">{pending ? strings.pendingHeading : strings.curatorHeading}</p>
          {pending ? (
            <span className="pt-adm-aside-muted">{strings.pendingManagerNotice}</span>
          ) : overview?.curatorDisplayName ? (
            <strong className="pt-adm-curator-name">{overview.curatorDisplayName}</strong>
          ) : (
            <span className="pt-adm-aside-muted">{strings.curatorEmpty}</span>
          )}
        </div>

        {pending ? (
          <div className="pt-adm-aside-card">
            <h3 className="pt-adm-aside-card-title">{strings.pendingApplicationHeading}</h3>
            <p className="pt-adm-aside-card-text">{strings.pendingApplicationHint}</p>
            <Link href="/apply/status" className="pt-link">
              {strings.pendingApplicationLink} <span aria-hidden="true">↗</span>
            </Link>
          </div>
        ) : null}

        <div className="pt-adm-aside-card">
          <h3 className="pt-adm-aside-card-title">{strings.helpHeading}</h3>
          <p className="pt-adm-aside-card-text">{strings.helpText}</p>
          <Link href="#case-help" className="pt-link">
            {strings.helpLink} <span aria-hidden="true">↗</span>
          </Link>
          {pending ? null : (
            <>
              <p className="pt-adm-aside-card-text">{strings.messagesNote}</p>
              <Link href="/portal/messages" className="pt-link">
                {strings.messagesLink} <span aria-hidden="true">↗</span>
              </Link>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
