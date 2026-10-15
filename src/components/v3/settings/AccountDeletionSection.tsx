import Link from "next/link";

import { Icon } from "@/components/icons";
import { Pill, type PillTone } from "@/components/v3/Pill";
import {
  accountDeletionDate,
  accountDeletionDaysLeft,
  type AccountDeletionDetail,
  type AccountDeletionQueueRow,
  type AccountDeletionReason,
} from "@/lib/account-deletion-contract";
import type { AccountDeletionDetailRead, AccountDeletionQueueRead } from "@/lib/v3/account-deletion-source";

import { AccountDeletionManualDone } from "./AccountDeletionManualDone";
import { AccountDeletionProcess } from "./AccountDeletionProcess";

/**
 * «Настройки» → «Запросы на удаление» (миграция 280, упрощение для 1.0).
 * Очередь: человек, когда попросил, срок (запрос + 30 дней; прошедший —
 * красным словом), состояние и как обрабатывается. Карточка запроса:
 *  - автоматически (простой аккаунт): что удалится, одно действие с
 *    подтверждением словом «удалить»;
 *  - «Ручная обработка» (всё остальное): почему, список того, что команда
 *    удаляет или обезличивает (docs/runbooks/account-deletion.md), и
 *    «Отметить выполненным» с заметкой и словом «выполнено».
 * Адрес несёт выбор (`?request=`), поэтому запрос можно переслать и
 * вернуться к списку кнопкой браузера.
 */

const KIND = { student: "Студент", applicant: "Анкета без одобрения" } as const;

const COUNT_WORDS: Readonly<Record<keyof AccountDeletionDetail["counts"], string>> = {
  application: "Анкета и её квитанции",
  profile: "Профиль, доступ и согласия",
  consultations: "Запросы консультаций",
  favourites: "Избранные вузы",
  tests: "Ответы на тесты и уроки",
  journal: "Записи журнала о них",
};

const REASON_WORDS: Readonly<Record<AccountDeletionReason, string>> = {
  staff: "это сотрудник",
  case: "есть дело студента",
  application_converted: "анкета одобрена, по ней создано дело",
  lead: "есть лид",
  client: "есть карточка клиента",
  payment: "есть платежи или оплаты",
  contract_file: "есть файл договора",
  whatsapp: "есть переписка WhatsApp",
  other_records: "есть другие записи, связанные с аккаунтом",
};

/** Что команда делает вручную (решение владельца 08.10.2026, инструкция docs/runbooks/account-deletion.md). */
const CHECKLIST: readonly Readonly<{ what: string; who: string }>[] = [
  { what: "Документы и файлы: строки документов, файлы в хранилище, выгрузки документов.", who: "технический администратор" },
  { what: "Переписка: чат в кабинете, чаты WhatsApp с сообщениями и медиа, данные ИИ (память, черновики, ответы).", who: "технический администратор" },
  { what: "Профиль студента, анкета, задачи, заметки, заявки в вузы, виза, тесты, уведомления, консультации, избранное.", who: "технический администратор" },
  { what: "Лид и карточка клиента: удалить; если ими пользуется другой человек, убрать только данные этого человека.", who: "Admin решает, технический администратор выполняет" },
  { what: "amoCRM: удалить контакт и сделку этого человека.", who: "Admin в amoCRM" },
  { what: "Договор и оплаты: сохранить обезличенными. Имя, телефон, email и номера документов убрать; суммы, даты и номер договора оставить.", who: "технический администратор" },
  { what: "Вход в аккаунт: удалить или отключить пользователя Supabase Auth, последним шагом.", who: "технический администратор" },
];

const LOGIN_WORDS = {
  active: "Вход в аккаунт ещё работает.",
  disabled: "Вход в аккаунт отключён.",
  absent: "Вход в аккаунт удалён.",
} as const;

const EMAIL_WORDS = {
  sent: "письмо с подтверждением отправлено",
  failed: "письмо не отправлено: ошибка почты",
  not_configured: "письмо не отправлено: почта в CRM не настроена",
  no_address: "письмо не отправлено: адреса нет",
} as const;

function dueText(row: AccountDeletionQueueRow, now: Date): Readonly<{ text: string; tone: PillTone }> {
  if (row.status === "completed") {
    return { text: row.completedAt && Date.parse(row.completedAt) > Date.parse(row.dueAt) ? "выполнено после срока" : "в срок", tone: "neutral" };
  }
  const days = accountDeletionDaysLeft(row.dueAt, now);
  if (row.overdue || days < 0) return { text: `просрочено на ${Math.max(1, -days)} дн.`, tone: "danger" };
  if (days === 0) return { text: "срок сегодня", tone: "warn" };
  return { text: `осталось ${days} дн.`, tone: days <= 5 ? "warn" : "neutral" };
}

function statusPill(row: AccountDeletionQueueRow) {
  if (row.status === "completed") return <Pill tone="ok">{row.mode === "manual" ? "выполнено" : "удалено"}</Pill>;
  if (row.status === "processing") return <Pill tone="warn">не завершено</Pill>;
  return <Pill tone="neutral">ждёт удаления</Pill>;
}

function modeText(row: AccountDeletionQueueRow): string {
  if (row.status === "completed") return row.mode === "manual" ? "вручную" : "автоматически";
  return row.mode === "manual" ? "ручная обработка" : "автоматически";
}

function Day({ at }: Readonly<{ at: string }>) {
  return <time dateTime={at} className="font-mono tabular-nums">{accountDeletionDate(at)}</time>;
}

const GRID = "grid grid-cols-1 gap-x-4 gap-y-1 px-4 @min-[44rem]/deletions:grid-cols-[minmax(0,34fr)_minmax(0,14fr)_minmax(0,22fr)_minmax(0,16fr)]";

export function AccountDeletionSection({
  queue,
  detail,
  hrefFor,
  now,
}: Readonly<{
  queue: AccountDeletionQueueRead;
  detail: AccountDeletionDetailRead | null;
  hrefFor: (requestId: string | null) => string;
  now: Date;
}>) {
  if (detail) return <AccountDeletionDetailView read={detail} backHref={hrefFor(null)} now={now} />;
  if (queue.status !== "ready") {
    return queue.status === "forbidden"
      ? <p className="t-body-compact text-fg-2">Запросы на удаление видит и выполняет только администратор.</p>
      : (
        <p role="alert" className="t-body-compact text-danger" data-testid="v3-deletions-unavailable">
          Не удалось загрузить запросы на удаление. Обновите страницу.
        </p>
      );
  }
  const rows = queue.rows;
  const open = rows.filter((row) => row.status !== "completed").length;
  if (rows.length === 0) {
    return (
      <div className="rounded-card border border-border bg-surface px-4 py-5" data-testid="v3-deletions-empty">
        <p className="t-item text-fg">Запросов на удаление нет</p>
        <p className="t-body-compact mt-1 max-w-[70ch] text-fg-2">
          Студент или человек после анкеты нажимает «Удалить аккаунт» в кабинете или в приложении iPhone. Запрос появится
          здесь со сроком: 30 дней с даты запроса.
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="t-body-compact text-fg-2" data-testid="v3-deletions-summary">
        {open === 0 ? "Открытых запросов нет." : `Открытых запросов: ${open}. Срок каждого: 30 дней с даты запроса.`}
      </p>
      <div className="@container/deletions">
        <table role="table" className="block w-full overflow-hidden rounded-card border border-border bg-surface" data-testid="v3-deletions">
          <caption className="sr-only">Запросы на удаление аккаунта: человек, дата запроса, срок и состояние</caption>
          <thead role="rowgroup" className="sr-only @min-[44rem]/deletions:not-sr-only @min-[44rem]/deletions:block">
            <tr role="row" className={`${GRID} border-b border-border py-2`}>
              {["Человек", "Запрос", "Срок", "Состояние"].map((label) => (
                <th key={label} role="columnheader" scope="col" className="t-caption flex items-center text-start text-fg-2">{label}</th>
              ))}
            </tr>
          </thead>
          <tbody role="rowgroup" className="block">
            {rows.map((row) => {
              const due = dueText(row, now);
              return (
                <tr key={row.id} role="row" data-request={row.id} data-status={row.status} data-mode={row.mode}
                  data-overdue={row.overdue || undefined}
                  className={`${GRID} border-b border-border py-3 last:border-b-0 @min-[44rem]/deletions:py-2.5`}>
                  <th role="rowheader" scope="row" className="min-w-0 text-start">
                    <Link href={hrefFor(row.id)} className="t-item break-words text-fg underline underline-offset-4 hover:text-fg-2">
                      {row.displayName}
                    </Link>
                    <span className="t-meta block break-all text-fg-2">
                      {KIND[row.kind]}{row.email ? ` · ${row.email}` : ""}
                    </span>
                  </th>
                  <td role="cell" className="t-body-compact min-w-0 text-fg">
                    <span className="t-caption me-1.5 text-fg-3 @min-[44rem]/deletions:sr-only">Запрос:</span>
                    <Day at={row.requestedAt} />
                  </td>
                  <td role="cell" className="t-body-compact min-w-0 text-fg">
                    <span className="t-caption me-1.5 text-fg-3 @min-[44rem]/deletions:sr-only">Срок:</span>
                    <span className={row.overdue ? "font-medium text-danger" : undefined}><Day at={row.dueAt} /></span>
                    <span className="ms-1.5"><Pill tone={due.tone}>{due.text}</Pill></span>
                  </td>
                  <td role="cell" className="t-body-compact min-w-0">
                    {statusPill(row)}
                    <span className="t-meta block text-fg-2">
                      {modeText(row)}
                      {row.status === "completed" && row.completedAt ? <>, <Day at={row.completedAt} /></> : null}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AutomaticPlan({ d }: Readonly<{ d: AccountDeletionDetail }>) {
  const items = Object.entries(COUNT_WORDS).filter(([key]) => d.counts[key as keyof typeof COUNT_WORDS] > 0);
  return (
    <div className="grid gap-4 rounded-card border border-border bg-surface px-4 py-4 md:grid-cols-2" data-testid="v3-deletion-automatic">
      <section className="min-w-0" data-testid="v3-deletion-delete">
        <h3 className="t-item text-fg">{d.status === "completed" ? "Удалено автоматически" : "Удалится автоматически"}</h3>
        <ul className="mt-1 flex flex-col">
          <li className="t-body-compact border-b border-border py-1.5 text-fg">Вход в аккаунт, email и пароль, журнал входов</li>
          {items.map(([key, label]) => (
            <li key={key} className="t-body-compact flex items-baseline justify-between gap-3 border-b border-border py-1.5 last:border-b-0">
              <span className="text-fg">{label}</span>
              <span className="tabular-nums text-fg-2">{d.counts[key as keyof typeof COUNT_WORDS]}</span>
            </li>
          ))}
        </ul>
      </section>
      <section className="min-w-0" data-testid="v3-deletion-remain">
        <h3 className="t-item text-fg">Не меняется</h3>
        <p className="t-body-compact mt-1 text-fg-2">
          Записи других людей и всё, что не связано с аккаунтом в базе. У этого аккаунта нет дела, лида, клиента,
          оплат, договора и переписки WhatsApp, поэтому удаление автоматическое. Резервные копии базы этим действием не
          меняются.
        </p>
      </section>
    </div>
  );
}

function ManualPlan({ d }: Readonly<{ d: AccountDeletionDetail }>) {
  const reasons = d.reasons.map((reason) => REASON_WORDS[reason]);
  return (
    <section className="flex flex-col gap-3 rounded-card border border-border bg-surface px-4 py-4" data-testid="v3-deletion-manual"
      aria-labelledby="v3-deletion-manual-title">
      <div>
        <h3 id="v3-deletion-manual-title" className="t-item text-fg">Ручная обработка</h3>
        {reasons.length > 0 ? (
          <p className="t-body-compact mt-1 text-fg-2" data-testid="v3-deletion-reasons">
            Автоматически удалить нельзя: {reasons.join("; ")}.
          </p>
        ) : null}
        {d.otherTables.length > 0 ? (
          <p className="t-meta mt-1 break-all text-fg-2" data-testid="v3-deletion-other-tables">
            Для технического администратора, другие записи в таблицах: {d.otherTables.join(", ")}.
          </p>
        ) : null}
      </div>
      <div>
        <p className="t-body-compact text-fg">
          Команда удаляет или обезличивает по списку в течение 30 дней с даты запроса. Порядок и кто что делает: инструкция
          «Удаление аккаунта вручную» (docs/runbooks/account-deletion.md). Многие пункты делает технический администратор
          с доступом к базе: в CRM для них кнопок нет.
        </p>
        <ol className="mt-2 flex flex-col" data-testid="v3-deletion-checklist">
          {CHECKLIST.map((item, index) => (
            <li key={item.what} className="t-body-compact flex gap-2 border-b border-border py-1.5 last:border-b-0">
              <span className="tabular-nums text-fg-2">{index + 1}.</span>
              <span className="min-w-0">
                <span className="text-fg">{item.what}</span>
                <span className="t-meta block text-fg-2">{item.who}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>
      <p className="t-body-compact text-fg" data-testid="v3-deletion-login" data-login={d.login}>
        {LOGIN_WORDS[d.login]}
      </p>
    </section>
  );
}

function AccountDeletionDetailView({ read, backHref, now }: Readonly<{
  read: AccountDeletionDetailRead;
  backHref: string;
  now: Date;
}>) {
  const back = (
    <Link href={backHref} className="inline-flex min-h-11 items-center gap-1.5 t-label text-fg underline underline-offset-4 hover:text-fg-2">
      <Icon name="arrow-left" size={16} />Все запросы
    </Link>
  );
  if (read.status !== "ready") {
    return (
      <div className="flex flex-col gap-3">
        {back}
        <p role="alert" className="t-body-compact text-danger">
          {read.status === "not_found" ? "Такого запроса нет." : read.status === "forbidden"
            ? "Запросы на удаление видит и выполняет только администратор."
            : "Не удалось загрузить запрос. Обновите страницу."}
        </p>
      </div>
    );
  }
  const d: AccountDeletionDetail = read.detail;
  const due = dueText(d, now);
  const open = d.status !== "completed";
  return (
    <div className="flex flex-col gap-4" data-testid="v3-deletion-detail" data-status={d.status} data-mode={d.mode}>
      {back}
      <header className="flex flex-col gap-1">
        <h3 className="t-record-title break-words text-fg">{d.displayName}</h3>
        <p className="t-body-compact break-all text-fg-2">{KIND[d.kind]}{d.email ? ` · ${d.email}` : ""}</p>
        <dl className="mt-1 flex flex-wrap gap-x-6 gap-y-1 t-body-compact">
          <div className="flex gap-1.5"><dt className="text-fg-2">Запрос</dt><dd className="text-fg"><Day at={d.requestedAt} /></dd></div>
          <div className="flex items-center gap-1.5">
            <dt className="text-fg-2">Срок</dt>
            <dd className={d.overdue ? "font-medium text-danger" : "text-fg"}><Day at={d.dueAt} /></dd>
            <dd><Pill tone={due.tone}>{due.text}</Pill></dd>
          </div>
          <div className="flex items-center gap-1.5"><dt className="text-fg-2">Состояние</dt><dd>{statusPill(d)}</dd><dd className="text-fg-2">{modeText(d)}</dd></div>
          {d.studentCaseId && open ? (
            <div className="flex gap-1.5"><dt className="sr-only">Дело</dt><dd>
              <Link href={`/v3/profile?case=${d.studentCaseId}&tab=overview`} className="text-fg underline underline-offset-4 hover:text-fg-2">Открыть дело</Link>
            </dd></div>
          ) : null}
        </dl>
      </header>

      {d.status === "completed" ? (
        <div role="status" className="flex items-start gap-2 rounded-card border border-border bg-surface px-4 py-3" data-testid="v3-deletion-result">
          <Icon name="circle-check" size={18} className="mt-0.5 shrink-0 text-ok" />
          <div className="min-w-0">
            <p className="t-body-compact text-fg">
              {d.mode === "manual" ? "Отмечено выполненным вручную" : "Аккаунт и связанные с ним данные удалены автоматически"}
              {d.completedAt ? <> <Day at={d.completedAt} /></> : null}
              {d.completedBy ? `, выполнил(а) ${d.completedBy}` : ""}
              {d.confirmationEmailStatus ? `; ${EMAIL_WORDS[d.confirmationEmailStatus]}` : "; статус письма не записан"}.
            </p>
            {d.manualNote ? (
              <p className="t-body-compact mt-1 whitespace-pre-line break-words text-fg-2" data-testid="v3-deletion-note-shown">
                Заметка: {d.manualNote}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
      {d.status === "processing" ? (
        <div role="alert" className="flex items-start gap-2 rounded-card border border-border bg-surface px-4 py-3" data-testid="v3-deletion-incomplete">
          <Icon name="alert" size={18} className="mt-0.5 shrink-0 text-warn" />
          <p className="t-body-compact text-fg">
            Удаление не завершено: записи в базе удалены{d.login !== "absent" ? ", но вход в аккаунт ещё есть" : ""}. Повторите удаление.
          </p>
        </div>
      ) : null}

      {d.mode === "automatic" ? <AutomaticPlan d={d} /> : open ? <ManualPlan d={d} /> : null}

      {open && d.mode === "automatic" ? (
        <AccountDeletionProcess requestRowId={d.id} requestedAt={d.requestedAt} displayName={d.displayName}
          retry={d.status === "processing"} />
      ) : null}
      {open && d.mode === "manual" ? (
        <AccountDeletionManualDone requestRowId={d.id} requestedAt={d.requestedAt} displayName={d.displayName}
          loginActive={d.login === "active"} />
      ) : null}
    </div>
  );
}
