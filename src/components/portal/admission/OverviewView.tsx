import Link from "next/link";

import { getLocale } from "@/lib/i18n";
import { getPortalStrings } from "@/lib/portal/i18n";

import type { StudentPortalAction, StudentPortalOverview } from "@/lib/v3/portal-source";
import { portalPendingCabinet } from "@/lib/v3/wording";
import { PortalStatus } from "./PortalStatus";
import { evoActionDueLabel, evoActionStatus, formatPortalMoney, studentActionDueLabel } from "./presentation";

function actionTitle(action: StudentPortalAction): string {
  const verb = action.kind === "payment" ? "Оплата" : action.kind === "upload_document" ? "Загрузите документ" : "Замените документ";
  return `${verb}: ${action.label}`;
}

function actionHref(action: StudentPortalAction): string {
  return action.kind === "payment" ? "/portal/payments" : `/portal/documents#document-${action.documentSlotId}`;
}

/** One flat row per queued action: title, due date, amount when relevant, and a direct link. No disclosure. */
function ActionRow({ action }: { action: StudentPortalAction }) {
  const due = studentActionDueLabel(action);
  return (
    <li className="pt-adm-row">
      <div className="pt-adm-row-main">
        <p className="pt-adm-row-title">{actionTitle(action)}</p>
        <dl className="pt-adm-row-meta">
          <div className="pt-adm-row-meta-item">
            <dt>Срок:</dt>
            <dd>{due && action.dueAt ? <time dateTime={action.dueAt}>{due}</time> : "Не указан"}</dd>
          </div>
          {action.kind === "payment" ? (
            <div className="pt-adm-row-meta-item">
              <dt>Сумма:</dt>
              <dd className="pt-data">{formatPortalMoney(action.amountMinor, action.currency)}</dd>
            </div>
          ) : null}
        </dl>
      </div>
      <Link href={actionHref(action)} className="pt-btn-ghost pt-adm-row-action">
        {action.kind === "payment" ? "Открыть оплату" : "Открыть документ"} <span aria-hidden="true">↗</span>
      </Link>
    </li>
  );
}

/**
 * Обзор «Моего поступления» в Атласе (PORT-5d): один заметный главный шаг,
 * очередь остальных действий и честная колонка команды EVO. Функциональные
 * контракты прежние: E2 DTO из portal-source, null-семантика 189 сохранена
 * (dueAt: null = «без срока» → «Не указан»).
 */
export function OverviewView({ overview, pending = false }: { overview: StudentPortalOverview | null; pending?: boolean }) {
  const admissionStrings = getPortalStrings("admission", getLocale());
  const primary = overview?.studentAction ?? null;
  const remaining = overview?.studentActions.slice(1) ?? [];
  const evoAction = overview?.evoAction ?? null;
  const evoDue = evoAction ? evoActionDueLabel(evoAction) : null;
  const evoStatus = evoAction ? evoActionStatus(evoAction) : null;

  return (
    <div className="pt-adm-grid">
      <div className="pt-adm-main">
        <section aria-labelledby="student-next-step" className="pt-card">
          <header className="pt-card-header">
            <h2 id="student-next-step" className="pt-card-title">
              {overview ? "Ваш следующий шаг" : "План поступления"}
            </h2>
            {primary ? <span className="pt-card-note">Что требуется от вас</span> : null}
          </header>

          {primary ? (
            <div className="pt-adm-hero">
              <div className="pt-adm-hero-head">
                <span aria-hidden="true" className="pt-adm-hero-icon">↗</span>
                <h3 className="pt-adm-hero-title">{actionTitle(primary)}</h3>
              </div>
              <p className="pt-adm-hero-lead">
                {primary.kind === "payment"
                  ? "Проверьте сумму, срок оплаты и указания команды EVO."
                  : primary.kind === "replace_document"
                    ? "Откройте замечания к документу и загрузите исправленный файл."
                    : "Откройте требование к документу и добавьте нужный файл."}
              </p>
              <dl className="pt-adm-hero-facts">
                <div className="pt-adm-hero-fact">
                  <dt>Срок выполнения · Бишкек</dt>
                  <dd>
                    {studentActionDueLabel(primary) && primary.dueAt ? (
                      <time dateTime={primary.dueAt}>{studentActionDueLabel(primary)}</time>
                    ) : "Не указан"}
                  </dd>
                </div>
                <div className="pt-adm-hero-fact">
                  <dt>{primary.kind === "payment" ? "Осталось оплатить" : "Документ"}</dt>
                  <dd>
                    {primary.kind === "payment" ? formatPortalMoney(primary.amountMinor, primary.currency) : primary.label}
                  </dd>
                </div>
              </dl>
              <Link href={actionHref(primary)} className="pt-btn pt-adm-hero-cta">
                {primary.kind === "payment" ? "Посмотреть начисление" : "Открыть документ"} <span aria-hidden="true">↗</span>
              </Link>
            </div>
          ) : (
            <div className="pt-adm-hero">
              <span aria-hidden="true" className="pt-adm-hero-icon pt-adm-hero-icon-calm">
                {overview ? "✓" : "—"}
              </span>
              <h3 className="pt-adm-hero-title pt-adm-hero-title-calm">
                {overview ? "Сейчас действий от вас не требуется" : "План поступления пока не опубликован"}
              </h3>
              <p className="pt-adm-hero-lead">
                {overview
                  ? "Сейчас нет действий по документам и оплате. Можно изучить университеты или задать вопрос куратору."
                  : "Команда EVO добавит сюда этапы поступления, следующий шаг и контакт куратора."}
              </p>
              <Link href="/portal/universities" className="pt-link pt-adm-hero-link">
                Изучить университеты <span aria-hidden="true">→</span>
              </Link>
            </div>
          )}

          {remaining.length ? (
            <div>
              <h3 className="pt-adm-subhead">
                Также требует внимания
                <span className="pt-data">{remaining.length}</span>
              </h3>
              <ul className="pt-adm-list">
                {remaining.map((action, index) => (
                  <ActionRow
                    key={action.kind === "payment" ? `${action.kind}:${action.label}:${action.dueAt}:${index}` : action.documentSlotId}
                    action={action}
                  />
                ))}
              </ul>
            </div>
          ) : null}

          <nav aria-label="Документы и оплата" className="pt-adm-footer-links">
            <Link href="/portal/documents" className="pt-link">
              Все документы <span aria-hidden="true">↗</span>
            </Link>
            <Link href="/portal/payments" className="pt-link">
              Все начисления <span aria-hidden="true">↗</span>
            </Link>
          </nav>
        </section>
      </div>

      <aside aria-label="Команда EVO и помощь" className="pt-adm-aside">
        <h2 className="pt-adm-aside-title">Что делает EVO</h2>
        {evoAction && evoStatus ? (
          <div id={`evo-task-${evoAction.taskId}`} className="pt-adm-evo">
            <p className="pt-adm-evo-title">{evoAction.title}</p>
            <div className="pt-adm-evo-meta">
              <PortalStatus label={evoStatus.label} tone={evoStatus.tone} />
              {evoDue ? <span className="pt-adm-evo-due">Срок: {evoDue}</span> : null}
            </div>
          </div>
        ) : (
          <p className="pt-adm-aside-muted">Нет опубликованной задачи команды EVO.</p>
        )}

        <div className="pt-adm-curator">
          <p className="pt-adm-curator-caption">{pending ? portalPendingCabinet.heading : "Ваш куратор"}</p>
          {pending ? (
            <span className="pt-adm-aside-muted">{portalPendingCabinet.managerNotice}</span>
          ) : overview?.curatorDisplayName ? (
            <strong className="pt-adm-curator-name">{overview.curatorDisplayName}</strong>
          ) : (
            <span className="pt-adm-aside-muted">Куратор пока не назначен.</span>
          )}
        </div>

        {pending ? (
          <div className="pt-adm-aside-card">
            <h3 className="pt-adm-aside-card-title">{portalPendingCabinet.applicationHeading}</h3>
            <p className="pt-adm-aside-card-text">{portalPendingCabinet.applicationHint}</p>
            <Link href="/apply/status" className="pt-link">
              {portalPendingCabinet.applicationLink} <span aria-hidden="true">↗</span>
            </Link>
          </div>
        ) : null}

        <div className="pt-adm-aside-card">
          <h3 className="pt-adm-aside-card-title">Вопрос куратору</h3>
          <p className="pt-adm-aside-card-text">Отправьте вопрос команде EVO или прочитайте ответ на ваше обращение.</p>
          <Link href="#case-help" className="pt-link">
            Открыть обращения <span aria-hidden="true">↗</span>
          </Link>
          {pending ? null : (
            <>
              <p className="pt-adm-aside-card-text">{admissionStrings.messagesNote}</p>
              <Link href="/portal/messages" className="pt-link">
                Открыть сообщения <span aria-hidden="true">↗</span>
              </Link>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
