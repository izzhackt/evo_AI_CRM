import Link from "next/link";

import type { StudentPortalAction, StudentPortalOverview } from "@/lib/v3/portal-source";
import { PortalStatus } from "./PortalStatus";
import { evoActionDueLabel, evoActionStatus, formatPortalMoney, overviewStage, studentActionDueLabel } from "./presentation";
import styles from "./OverviewView.module.css";

function actionTitle(action: StudentPortalAction): string {
  const verb = action.kind === "payment" ? "Оплата" : action.kind === "upload_document" ? "Загрузите документ" : "Замените документ";
  return `${verb}: ${action.label}`;
}

function actionHref(action: StudentPortalAction): string {
  return action.kind === "payment" ? "/portal/payments" : `/portal/documents#document-${action.documentSlotId}`;
}

function ActionDetails({ action }: { action: StudentPortalAction }) {
  const due = studentActionDueLabel(action);
  return <>
    <p className={styles.explanation}>{action.kind === "payment"
      ? "Проверьте сумму, срок оплаты и указания команды EVO."
      : action.kind === "replace_document"
        ? "Откройте замечания к документу и загрузите исправленный файл."
        : "Откройте требование к документу и добавьте нужный файл."}</p>
    <dl className={styles.metadata}>
      <div><dt>Срок выполнения</dt><dd>{due && action.dueAt ? <time dateTime={action.dueAt}>{due}</time> : "Не указан"}</dd></div>
      <div><dt>{action.kind === "payment" ? "Осталось оплатить" : "Документ"}</dt><dd>{action.kind === "payment" ? formatPortalMoney(action.amountMinor, action.currency) : action.label}</dd></div>
    </dl>
    <Link className={`${styles.primaryAction} min-h-11`} href={actionHref(action)}>
      {action.kind === "payment" ? "Посмотреть начисление" : "Открыть документ"}<span aria-hidden="true">↗</span>
    </Link>
  </>;
}

export function OverviewView({ overview }: { overview: StudentPortalOverview | null }) {
  const primary = overview?.studentAction ?? null;
  const remaining = overview?.studentActions.slice(1) ?? [];
  const stage = overview ? overviewStage(overview) : null;
  const evoAction = overview?.evoAction ?? null;
  const evoDue = evoAction ? evoActionDueLabel(evoAction) : null;
  const evoStatus = evoAction ? evoActionStatus(evoAction) : null;

  return <div className={styles.workspace}>
    {stage ? <div className={styles.stage}><p>Текущий этап</p><PortalStatus label={stage.label} tone={stage.tone} /></div> : null}
    <div>
      <section className={styles.sheet} aria-labelledby="student-next-step">
        <header className={styles.band}>
          <h2 id="student-next-step">{overview ? "Ваш следующий шаг" : "План поступления"}</h2>
          {primary ? <span>Что требуется от вас</span> : null}
        </header>
        {primary ? <div className={styles.expanded}>
          <div className={styles.actionHeading}><span className={styles.actionIcon} aria-hidden="true">↗</span><h3>{actionTitle(primary)}</h3></div>
          <ActionDetails action={primary} />
        </div> : <div className={styles.empty}>
          <span className={styles.emptyIcon} aria-hidden="true">{overview ? "✓" : "—"}</span>
          <h3>{overview ? "Сейчас действий от вас не требуется" : "План поступления пока не опубликован"}</h3>
          <p>{overview
            ? "Сейчас нет действий по документам и оплате. Можно изучить университеты или задать вопрос куратору."
            : "Команда EVO добавит сюда этапы поступления, следующий шаг и контакт куратора."}</p>
          <Link className={styles.exploreLink} href="/portal/universities">Изучить университеты <span aria-hidden="true">→</span></Link>
        </div>}
        {remaining.length ? <div className={styles.queue}>
          <h3 className={styles.queueTitle}>Также требует внимания <span>{remaining.length}</span></h3>
          {remaining.map((action, index) => <details key={action.kind === "payment" ? `${action.kind}:${action.label}:${action.dueAt}:${index}` : action.documentSlotId} className={styles.queueItem}>
            <summary><span className={styles.rowMarker} aria-hidden="true" /><span>{actionTitle(action)}</span><span className={styles.expandIcon} aria-hidden="true">+</span></summary>
            <div className={styles.queueDetails}><ActionDetails action={action} /></div>
          </details>)}
        </div> : null}
        <nav className={styles.sheetLinks} aria-label="Документы и оплата">
          <Link href="/portal/documents">Все документы <span aria-hidden="true">↗</span></Link>
          <Link href="/portal/payments">Все начисления <span aria-hidden="true">↗</span></Link>
        </nav>
      </section>
      {primary ? <p className={styles.queueHint}>Ближайший срок — первым. Подробности остальных действий можно раскрыть в списке.</p> : null}
    </div>

    <aside className={styles.team} aria-label="Команда EVO и помощь">
      <h2>Что делает EVO</h2>
      {evoAction && evoStatus ? <details id={`evo-task-${evoAction.taskId}`} className={styles.teamTask} open>
        <summary><span>{evoAction.title}</span><span className={styles.expandIcon} aria-hidden="true">+</span></summary>
        <div className={styles.teamTaskBody}>
          <PortalStatus label={evoStatus.label} tone={evoStatus.tone} />
          {evoDue ? <p>Срок: {evoDue}</p> : null}
        </div>
      </details> : <p className={styles.teamEmpty}>Нет опубликованной задачи команды EVO.</p>}
      <div className={styles.curator}>
        <p>Ваш куратор</p>
        {overview?.curatorDisplayName ? <strong>{overview.curatorDisplayName}</strong> : <span>Куратор пока не назначен.</span>}
      </div>
      <div className={styles.helpCard}>
        <h3>Вопрос куратору</h3>
        <p>Отправьте вопрос команде EVO или прочитайте ответ на ваше обращение.</p>
        <Link className="min-h-11" href="#case-help">Открыть обращения <span aria-hidden="true">↗</span></Link>
      </div>
    </aside>
  </div>;
}
