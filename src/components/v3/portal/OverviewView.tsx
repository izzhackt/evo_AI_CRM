import Link from "next/link";

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
    <li className="flex flex-col gap-2 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-5">
      <div className="min-w-0">
        <p className="break-words text-sm font-semibold text-fg">{actionTitle(action)}</p>
        <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-3">
          <div className="flex gap-1">
            <dt>Срок:</dt>
            <dd>{due && action.dueAt ? <time dateTime={action.dueAt}>{due}</time> : "Не указан"}</dd>
          </div>
          {action.kind === "payment" ? (
            <div className="flex gap-1">
              <dt>Сумма:</dt>
              <dd className="font-mono tabular-nums text-fg-2">{formatPortalMoney(action.amountMinor, action.currency)}</dd>
            </div>
          ) : null}
        </dl>
      </div>
      <Link
        href={actionHref(action)}
        className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-nav border border-control-edge bg-surface px-3 text-sm font-semibold text-fg transition-colors hover:bg-surface-2"
      >
        {action.kind === "payment" ? "Открыть оплату" : "Открыть документ"} <span aria-hidden="true">↗</span>
      </Link>
    </li>
  );
}

export function OverviewView({ overview, pending = false }: { overview: StudentPortalOverview | null; pending?: boolean }) {
  const primary = overview?.studentAction ?? null;
  const remaining = overview?.studentActions.slice(1) ?? [];
  const evoAction = overview?.evoAction ?? null;
  const evoDue = evoAction ? evoActionDueLabel(evoAction) : null;
  const evoStatus = evoAction ? evoActionStatus(evoAction) : null;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.9fr)_minmax(235px,1fr)]">
      <div className="min-w-0 space-y-4">
        <section aria-labelledby="student-next-step" className="min-w-0 overflow-hidden rounded-card border border-border bg-surface">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-4">
            <h2 id="student-next-step" className="text-sm font-semibold text-fg">
              {overview ? "Ваш следующий шаг" : "План поступления"}
            </h2>
            {primary ? <span className="text-xs text-fg-3">Что требуется от вас</span> : null}
          </header>

          {primary ? (
            <div className="px-5 py-6">
              <div className="flex items-start gap-3.5">
                <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-nav bg-accent-weak text-lg text-accent-text">↗</span>
                <h3 className="break-words text-xl font-semibold leading-snug tracking-[-0.02em] text-fg sm:text-2xl">{actionTitle(primary)}</h3>
              </div>
              <p className="mt-3.5 max-w-[540px] text-sm leading-7 text-fg-2">
                {primary.kind === "payment"
                  ? "Проверьте сумму, срок оплаты и указания команды EVO."
                  : primary.kind === "replace_document"
                    ? "Откройте замечания к документу и загрузите исправленный файл."
                    : "Откройте требование к документу и добавьте нужный файл."}
              </p>
              <dl className="mt-5 flex flex-wrap gap-x-8 gap-y-4 border-t border-border pt-4">
                <div className="min-w-[165px] flex-1">
                  <dt className="text-xs text-fg-3">Срок выполнения · Бишкек</dt>
                  <dd className="mt-1.5 text-sm text-fg">
                    {studentActionDueLabel(primary) && primary.dueAt ? (
                      <time dateTime={primary.dueAt}>{studentActionDueLabel(primary)}</time>
                    ) : "Не указан"}
                  </dd>
                </div>
                <div className="min-w-[165px] flex-1">
                  <dt className="text-xs text-fg-3">{primary.kind === "payment" ? "Осталось оплатить" : "Документ"}</dt>
                  <dd className="mt-1.5 break-words text-sm text-fg">
                    {primary.kind === "payment" ? formatPortalMoney(primary.amountMinor, primary.currency) : primary.label}
                  </dd>
                </div>
              </dl>
              <Link
                href={actionHref(primary)}
                className="mt-5 inline-flex min-h-11 items-center justify-center gap-3 rounded-ctl bg-accent px-4 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-2"
              >
                {primary.kind === "payment" ? "Посмотреть начисление" : "Открыть документ"} <span aria-hidden="true">↗</span>
              </Link>
            </div>
          ) : (
            <div className="px-5 py-8">
              <span aria-hidden="true" className="mb-4 grid size-9 place-items-center rounded-nav bg-accent-weak text-lg text-accent-text">
                {overview ? "✓" : "—"}
              </span>
              <h3 className="max-w-[420px] text-xl font-semibold leading-snug text-fg sm:text-2xl">
                {overview ? "Сейчас действий от вас не требуется" : "План поступления пока не опубликован"}
              </h3>
              <p className="mt-3 max-w-[480px] text-sm leading-7 text-fg-2">
                {overview
                  ? "Сейчас нет действий по документам и оплате. Можно изучить университеты или задать вопрос куратору."
                  : "Команда EVO добавит сюда этапы поступления, следующий шаг и контакт куратора."}
              </p>
              <Link href="/portal/universities" className="mt-4 inline-flex min-h-11 items-center gap-3 text-sm font-semibold text-accent-text hover:underline hover:underline-offset-4">
                Изучить университеты <span aria-hidden="true">→</span>
              </Link>
            </div>
          )}

          {remaining.length ? (
            <div>
              <h3 className="flex items-center justify-between gap-3 border-y border-border bg-bg px-5 py-3 text-xs font-medium uppercase tracking-[0.06em] text-fg-3">
                Также требует внимания
                <span className="font-mono normal-case tracking-normal tabular-nums">{remaining.length}</span>
              </h3>
              <ul className="divide-y divide-border">
                {remaining.map((action, index) => (
                  <ActionRow
                    key={action.kind === "payment" ? `${action.kind}:${action.label}:${action.dueAt}:${index}` : action.documentSlotId}
                    action={action}
                  />
                ))}
              </ul>
            </div>
          ) : null}

          <nav aria-label="Документы и оплата" className="flex flex-wrap gap-x-5 gap-y-1 px-5 py-3">
            <Link href="/portal/documents" className="inline-flex min-h-11 items-center gap-2 text-xs font-medium text-accent-text hover:underline hover:underline-offset-4">
              Все документы <span aria-hidden="true">↗</span>
            </Link>
            <Link href="/portal/payments" className="inline-flex min-h-11 items-center gap-2 text-xs font-medium text-accent-text hover:underline hover:underline-offset-4">
              Все начисления <span aria-hidden="true">↗</span>
            </Link>
          </nav>
        </section>
      </div>

      <aside aria-label="Команда EVO и помощь" className="min-w-0">
        <h2 className="mb-2.5 text-base font-semibold tracking-[-0.015em] text-fg">Что делает EVO</h2>
        {evoAction && evoStatus ? (
          <div id={`evo-task-${evoAction.taskId}`} className="scroll-mt-6 border-s-2 border-border-strong ps-3.5">
            <p className="break-words text-sm font-medium text-fg">{evoAction.title}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <PortalStatus label={evoStatus.label} tone={evoStatus.tone} />
              {evoDue ? <span className="text-xs text-fg-3">Срок: {evoDue}</span> : null}
            </div>
          </div>
        ) : (
          <p className="text-sm leading-7 text-fg-3">Нет опубликованной задачи команды EVO.</p>
        )}

        <div className="mt-6 border-t border-border pt-5">
          <p className="text-xs text-fg-3">{pending ? portalPendingCabinet.heading : "Ваш куратор"}</p>
          {pending ? (
            <span className="mt-2 block text-xs leading-6 text-fg-3">{portalPendingCabinet.managerNotice}</span>
          ) : overview?.curatorDisplayName ? (
            <strong className="mt-2 block break-words text-sm font-semibold text-fg">{overview.curatorDisplayName}</strong>
          ) : (
            <span className="mt-2 block text-xs leading-6 text-fg-3">Куратор пока не назначен.</span>
          )}
        </div>

        {pending ? (
          <div className="mt-6 rounded-card border border-border bg-surface p-5">
            <h3 className="text-sm font-semibold text-accent-text">{portalPendingCabinet.applicationHeading}</h3>
            <p className="mt-2 text-xs leading-6 text-fg-2">{portalPendingCabinet.applicationHint}</p>
            <Link href="/apply/status" className="mt-2.5 flex min-h-11 items-center gap-3 text-xs font-semibold text-accent-text hover:underline hover:underline-offset-4">
              {portalPendingCabinet.applicationLink} <span aria-hidden="true">↗</span>
            </Link>
          </div>
        ) : null}

        <div className="mt-6 rounded-card border border-border bg-surface p-5">
          <h3 className="text-sm font-semibold text-accent-text">Вопрос куратору</h3>
          <p className="mt-2 text-xs leading-6 text-fg-2">Отправьте вопрос команде EVO или прочитайте ответ на ваше обращение.</p>
          <Link href="#case-help" className="mt-2.5 flex min-h-11 items-center gap-3 text-xs font-semibold text-accent-text hover:underline hover:underline-offset-4">
            Открыть обращения <span aria-hidden="true">↗</span>
          </Link>
        </div>
      </aside>
    </div>
  );
}
