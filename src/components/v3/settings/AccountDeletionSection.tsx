import Link from "next/link";

import { Icon } from "@/components/icons";
import { Pill, type PillTone } from "@/components/v3/Pill";
import {
  accountDeletionDate,
  accountDeletionDaysLeft,
  type AccountDeletionDetail,
  type AccountDeletionQueueRow,
} from "@/lib/account-deletion-contract";
import type { AccountDeletionDetailRead, AccountDeletionQueueRead } from "@/lib/v3/account-deletion-source";

import { AccountDeletionProcess } from "./AccountDeletionProcess";

/**
 * «Настройки» → «Запросы на удаление» (миграция 279, решение владельца 4).
 * Очередь: человек, когда попросил, срок (запрос + 30 дней; прошедший —
 * красным словом), состояние. Карточка запроса: что удалится, что останется
 * обезличенным и что этим действием не удаляется; затем одно разрушительное
 * действие с подтверждением словом. Адрес несёт выбор (`?request=`), поэтому
 * запрос можно переслать и вернуться к списку кнопкой браузера.
 */

const KIND = { student: "Студент", applicant: "Анкета без одобрения" } as const;

const DELETE_WORDS: Readonly<Record<string, string>> = {
  applications: "Анкета",
  documents: "Документы",
  files: "Файлы в хранилище",
  chatMessages: "Сообщения в кабинете",
  whatsappChats: "Переписка WhatsApp с отделом продаж и данные ИИ",
  notifications: "Уведомления",
  testAnswers: "Ответы на тесты и уроки",
  consultations: "Запросы консультаций",
  profileFacts: "Данные профиля: паспорт, контакты, родители",
  caseWork: "Задачи, заметки, заявки в вузы и виза",
};
const ANONYMIZE_WORDS: Readonly<Record<string, string>> = {
  cases: "Дело",
  clients: "Карточка клиента",
  leads: "Лид, уходит в архив",
  paymentObligations: "Платежи по договору",
  payments: "Поступившие оплаты",
  salesRecords: "Строка в отчёте продаж",
};
const REMAIN_WORDS: Readonly<Record<string, string>> = {
  amocrmContacts: "Контакт и сделка в amoCRM",
  sharedClients: "Клиент, у которого есть дело другого человека",
};

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
  if (row.status === "completed") return <Pill tone="ok">удалено</Pill>;
  if (row.status === "processing") return <Pill tone="warn">не завершено</Pill>;
  return <Pill tone="neutral">ждёт удаления</Pill>;
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
                <tr key={row.id} role="row" data-request={row.id} data-status={row.status} data-overdue={row.overdue || undefined}
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
                    {row.status === "completed" && row.completedAt ? (
                      <span className="t-meta block text-fg-2"><Day at={row.completedAt} /></span>
                    ) : null}
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

function CountList({ title, words, counts, testId, zeroHidden = true }: Readonly<{
  title: string;
  words: Readonly<Record<string, string>>;
  counts: Readonly<Record<string, number>>;
  testId: string;
  zeroHidden?: boolean;
}>) {
  const items = Object.entries(words).filter(([key]) => !zeroHidden || (counts[key] ?? 0) > 0);
  return (
    <section className="min-w-0" data-testid={testId}>
      <h3 className="t-item text-fg">{title}</h3>
      {items.length === 0 ? (
        <p className="t-body-compact mt-1 text-fg-2">Ничего</p>
      ) : (
        <ul className="mt-1 flex flex-col">
          {items.map(([key, word]) => (
            <li key={key} className="t-body-compact flex items-baseline justify-between gap-3 border-b border-border py-1.5 last:border-b-0">
              <span className="text-fg">{word}</span>
              <span className="tabular-nums text-fg-2">{counts[key] ?? 0}</span>
            </li>
          ))}
        </ul>
      )}
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
  return (
    <div className="flex flex-col gap-4" data-testid="v3-deletion-detail" data-status={d.status}>
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
          <div className="flex items-center gap-1.5"><dt className="text-fg-2">Состояние</dt><dd>{statusPill(d)}</dd></div>
          {d.studentCaseId && d.status !== "completed" ? (
            <div className="flex gap-1.5"><dt className="sr-only">Дело</dt><dd>
              <Link href={`/v3/profile?case=${d.studentCaseId}&tab=overview`} className="text-fg underline underline-offset-4 hover:text-fg-2">Открыть дело</Link>
            </dd></div>
          ) : null}
        </dl>
      </header>

      {d.status === "completed" ? (
        <div role="status" className="flex items-start gap-2 rounded-card border border-border bg-surface px-4 py-3" data-testid="v3-deletion-result">
          <Icon name="circle-check" size={18} className="mt-0.5 shrink-0 text-ok" />
          <p className="t-body-compact text-fg">
            Аккаунт и личные данные удалены{d.completedAt ? <> <Day at={d.completedAt} /></> : null}
            {d.completedBy ? `, выполнил(а) ${d.completedBy}` : ""}
            {d.confirmationEmailStatus ? `; ${EMAIL_WORDS[d.confirmationEmailStatus]}` : ""}.
          </p>
        </div>
      ) : null}
      {d.status === "processing" ? (
        <div role="alert" className="flex items-start gap-2 rounded-card border border-border bg-surface px-4 py-3" data-testid="v3-deletion-incomplete">
          <Icon name="alert" size={18} className="mt-0.5 shrink-0 text-warn" />
          <p className="t-body-compact text-fg">
            Удаление не завершено: строки базы удалены и обезличены
            {d.pendingFiles > 0 ? `, но осталось файлов: ${d.pendingFiles}` : ""}
            {d.authAccountExists ? `${d.pendingFiles > 0 ? " и" : ", но остался"} вход в аккаунт` : ""}. Повторите удаление.
          </p>
        </div>
      ) : null}

      <div className="grid gap-4 rounded-card border border-border bg-surface px-4 py-4 @container md:grid-cols-3">
        <div className="min-w-0">
          <CountList
            title={d.status === "completed" ? "Удалено" : "Удалится"}
            words={DELETE_WORDS}
            counts={d.counts.delete}
            testId="v3-deletion-delete"
          />
          <p className="t-meta mt-2 text-fg-2">Всегда: вход в аккаунт, email и пароль, журнал входов Supabase.</p>
        </div>
        <CountList
          title={d.status === "completed" ? "Осталось обезличенным" : "Останется обезличенным"}
          words={ANONYMIZE_WORDS}
          counts={d.counts.anonymize}
          testId="v3-deletion-anonymize"
        />
        <div className="min-w-0">
          <CountList
            title="Не удаляется этим действием"
            words={REMAIN_WORDS}
            counts={d.counts.remain}
            testId="v3-deletion-remain"
          />
          {Object.values(d.counts.remain).some((value) => value > 0) ? (
            <p className="t-meta mt-2 text-fg-2">Эти данные нужно удалить отдельно: в amoCRM или в деле другого человека.</p>
          ) : null}
        </div>
      </div>
      <p className="t-meta max-w-[70ch] text-fg-2">
        Остаётся обезличенным: имя заменяется на «Удалённый пользователь · номер запроса»; телефон, email, заметки
        и номера документов удаляются; суммы, валюта, даты, услуга и номер договора сохраняются, как требует закон.
      </p>

      {d.status !== "completed" ? (
        <AccountDeletionProcess
          requestRowId={d.id}
          requestedAt={d.requestedAt}
          displayName={d.displayName}
          retry={d.status === "processing"}
          amocrmContacts={d.amocrmContacts}
        />
      ) : null}
    </div>
  );
}
