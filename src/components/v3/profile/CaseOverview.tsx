import Link from "next/link";
import type { ReactNode } from "react";

import type { HandoffAcknowledgement } from "@/lib/platform-handoff-acknowledgement";
import type { StudentCaseChecklistCounts } from "@/lib/platform-student-case-queue-contract";
import { applicationStatus, caseChatAwaitState } from "@/lib/v3/wording";

import { Icon } from "@/components/icons";

import { Pill } from "../Pill";
import { formatQueueDay } from "../queue/due-bucket";
import { studentsDocumentsLine, studentsHandoffPending } from "../students/students-queue-view";
import { isNextLook, type V3Look } from "../blocks/look";
import { ProgressBar } from "../blocks/ProgressBar";
import { StatusChip } from "../blocks/StatusChip";
import type { TaskRowPermissions } from "../tasks/TaskQueueRow";
import { CaseDisclosure } from "./CaseDisclosure";
import { CaseHandoffBlock } from "./CaseHandoffBlock";
import { CaseTaskList } from "./CaseTaskList";
import { HandoffResponseSummary } from "./ProfileSalesTransition";
import { caseMomentLabel, type CaseApplicationLine, type CaseWorkRead } from "./case-work-view";

const SECTION = "min-w-0 space-y-2 border-t border-border pt-4";
const HEAD = "flex flex-wrap items-center justify-between gap-x-3";
const LINK = "inline-flex min-h-11 items-center t-label text-fg-2 underline underline-offset-4 hover:text-fg";
const TONE = { danger: "text-danger", warn: "text-warn", muted: "text-fg-2" } as const;
/** Раскрытие «Изменить ответ» в «Сведениях»: подпись-действие без маркера, 44 px. */
const SUMMARY = "flex min-h-11 w-fit cursor-pointer list-none items-center t-label text-fg-2 underline underline-offset-4 hover:text-fg [&::-webkit-details-marker]:hidden";

export type CaseOverviewInput = Readonly<{
  studentCaseId: string;
  work: CaseWorkRead;
  /** Снимок «Приёма дела»; блок «Принять дело» — только пока куратор может ответить и дело не принято. */
  handoff: (HandoffAcknowledgement & Readonly<{ requestId: string }>) | null;
  taskPermissions: TaskRowPermissions;
  /** «+ Задача» — диалог создания задачи по делу; null — создавать нельзя. */
  createTask: ReactNode;
  /** null — нет права читать документы дела (нет чтения — нет числа). */
  documents: StudentCaseChecklistCounts | null;
  applications: readonly CaseApplicationLine[];
  /** null — оплаты в этом деле этому сотруднику не видно. */
  payment: Readonly<{ percent: number | null; remaining: string | null; financeStop: string | null }> | null;
  contacts: Readonly<{ phone: string | null; email: string | null }>;
  /** «Доступ к порталу»: строка состояния и раскрытие с прежней карточкой; null — строки нет. */
  portal: Readonly<{ text: string; tone: "muted" | "warn" | "ok"; settings: ReactNode }> | null;
  /** Продажа в «Сведениях»; null — у сотрудника нет чтения продаж. */
  sales: Readonly<{ manager: string | null; nextAction: string | null }> | null;
  /** Формы продажи — свёрнутый раздел «Данные продажи»; null — раздела нет. */
  salesData: ReactNode;
  salesDataOpen: boolean;
  help: ReactNode;
  notes: ReactNode;
  hrefs: Readonly<{ documents: string | null; route: string | null; money: string | null; messages: string }>;
  /** Новый облик (Э1.3): блоки в строках задач и полоса документов из прочитанных чисел. */
  look?: V3Look;
}>;

function Fact({ term, children }: Readonly<{ term: string; children: ReactNode }>) {
  return (
    <div className="min-w-0 border-b border-border py-2.5 last:border-b-0">
      <dt className="t-caption text-fg-2">{term}</dt>
      <dd className="mt-0.5 min-w-0 break-words t-body-compact text-fg">{children}</dd>
    </div>
  );
}

function Tasks({ input, headingId }: Readonly<{ input: CaseOverviewInput; headingId: string }>) {
  const { work } = input;
  const pending = input.handoff !== null && studentsHandoffPending(input.handoff);
  return (
    // `#case-tasks` — адрес «Все задачи дела» из «Быстрого просмотра» (#1059).
    <section id="case-tasks" aria-labelledby={headingId} className="min-w-0 scroll-mt-4 space-y-3" data-testid="v3-case-next">
      <div className={HEAD}>
        <h2 id={headingId} tabIndex={-1} data-queue-heading="" className="t-section text-fg">Что дальше</h2>
        {input.createTask}
      </div>
      {pending && input.handoff ? <CaseHandoffBlock snapshot={input.handoff} headingId={headingId} /> : null}
      {work.tasks.kind === "unavailable" ? (
        <p role="alert" className="t-body-compact text-danger">Не удалось загрузить задачи. Обновите страницу, чтобы повторить.</p>
      ) : work.tasks.tasks.length === 0 ? (
        <p className="t-body-compact text-fg-2">Открытых задач нет.</p>
      ) : (
        <CaseTaskList tasks={work.tasks.tasks} permissions={input.taskPermissions} nowIso={work.nowIso} look={input.look} />
      )}
    </section>
  );
}

function Documents({ input }: Readonly<{ input: CaseOverviewInput }>) {
  const line = studentsDocumentsLine(input.documents);
  return (
    <section aria-labelledby="case-documents-title" className={SECTION}>
      <div className={HEAD}>
        <h2 id="case-documents-title" className="t-section text-fg">Документы</h2>
        {input.hrefs.documents ? <Link href={input.hrefs.documents} className={LINK}>Документы дела</Link> : null}
      </div>
      {line && isNextLook(input.look) ? (
        // Новый облик: «N из M принято» полосой — только из прочитанных чисел; пустой чек-лист
        // или числа, которые не сходятся, — прежняя строка без полосы.
        <div className="space-y-2">
          <ProgressBar done={input.documents?.approved} total={input.documents?.total} word="принято"
            fallback={<p className="t-body-compact text-fg">{line.summary}</p>} />
          {line.parts.length ? (
            <p className="flex flex-wrap gap-1">
              {line.parts.map((part) => <StatusChip key={part.key} label={part.text} tone={part.tone === "warn" ? "warn" : part.tone === "danger" ? "danger" : "neutral"} />)}
            </p>
          ) : null}
        </div>
      ) : line ? (
        <p className="t-body-compact text-fg">
          {line.summary}
          {line.parts.map((part) => <span key={part.key}><span className="text-fg-3"> · </span><span className={`font-medium ${TONE[part.tone]}`}>{part.text}</span></span>)}
        </p>
      ) : <p className="t-body-compact text-fg-2">Нет доступа к документам этого дела.</p>}
    </section>
  );
}

function Correspondence({ input }: Readonly<{ input: CaseOverviewInput }>) {
  const chat = input.work.chat;
  return (
    <section aria-labelledby="case-chat-title" className={SECTION}>
      <div className={HEAD}>
        <h2 id="case-chat-title" className="flex flex-wrap items-center gap-2 t-section text-fg">
          Переписка
          {chat.kind === "ready" && chat.awaitState === "needs_reply" ? <Pill tone="danger">{caseChatAwaitState("needs_reply")}</Pill> : null}
          {chat.kind === "ready" && chat.awaitState === "awaiting_student" ? <Pill>{caseChatAwaitState("awaiting_student")}</Pill> : null}
        </h2>
        {chat.kind !== "forbidden" ? <Link href={input.hrefs.messages} className={LINK}>Открыть переписку</Link> : null}
      </div>
      {chat.kind === "forbidden" ? (
        <p className="t-body-compact text-fg-2">Нет доступа к переписке этого дела.</p>
      ) : chat.kind === "unavailable" ? (
        <p className="t-body-compact text-fg-2">Переписку сейчас не удалось прочитать.</p>
      ) : chat.last === null ? (
        <p className="t-body-compact text-fg-2">Сообщений пока нет.</p>
      ) : (
        <p className="min-w-0 t-body-compact text-fg">
          <span className="text-fg-2">{chat.last.mine ? "Вы" : chat.last.authorName} · </span>
          <time dateTime={chat.last.createdAt} className="font-mono tabular-nums text-fg-2">{caseMomentLabel(chat.last.createdAt, input.work.today)}</time>
          <span className="block break-words">{chat.last.text}</span>
        </p>
      )}
      {input.help}
    </section>
  );
}

function Applications({ input }: Readonly<{ input: CaseOverviewInput }>) {
  return (
    <section aria-labelledby="case-applications-title" className={SECTION}>
      <div className={HEAD}>
        <h2 id="case-applications-title" className="t-section text-fg">Заявки</h2>
        {input.hrefs.route ? <Link href={input.hrefs.route} className={LINK}>Вузы и программы</Link> : null}
      </div>
      {input.applications.length === 0 ? <p className="t-body-compact text-fg-2">Заявок пока нет.</p> : (
        <ul className="divide-y divide-border">
          {input.applications.map((application) => (
            <li key={application.id} className="py-1.5 t-body-compact">
              <span className="break-words font-medium text-fg">{application.title}</span>
              <span className="text-fg-2">
                {" — "}{applicationStatus(application.status) ?? "статус не указан"}
                {application.primary ? " · основной вариант" : null}
                {application.deadlineOn ? <> · дедлайн <time dateTime={application.deadlineOn} className="font-mono tabular-nums">{formatQueueDay(application.deadlineOn, input.work.today)}</time></> : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Payment({ input }: Readonly<{ input: CaseOverviewInput }>) {
  const payment = input.payment;
  if (!payment) return null;
  return (
    <section aria-labelledby="case-payment-title" className={SECTION}>
      <div className={HEAD}>
        <h2 id="case-payment-title" className="t-section text-fg">Оплата</h2>
        {input.hrefs.money ? <Link href={input.hrefs.money} className={LINK}>Договор и оплата</Link> : null}
      </div>
      <p className="t-body-compact text-fg">
        {payment.percent === null ? <span className="text-fg-2">Плана платежей нет</span> : (
          <><span className="font-semibold tabular-nums">{payment.percent}%</span> оплачено{payment.remaining ? <span className="text-fg-2"> · остаток <span className="tabular-nums">{payment.remaining}</span></span> : null}</>
        )}
        {payment.financeStop ? <span className="block text-danger">Финансовый стоп: {payment.financeStop}</span> : null}
      </p>
    </section>
  );
}

/**
 * «Доступ к порталу» — строка состояния; «Настроить» раскрывает прежнюю
 * карточку (проверка и приглашение, решение по анкете) на всю ширину.
 */
function PortalAccess({ input }: Readonly<{ input: CaseOverviewInput }>) {
  const portal = input.portal;
  if (!portal) return null;
  const header = <>
    <h2 id="case-portal-title" className="t-section text-fg">Доступ к порталу</h2>
    <span className={`t-body-compact ${portal.tone === "warn" ? "text-warn" : portal.tone === "ok" ? "text-fg" : "text-fg-2"}`}>{portal.text}</span>
  </>;
  return (
    <section aria-labelledby="case-portal-title" className={SECTION} data-testid="v3-case-portal">
      {portal.settings ? (
        <CaseDisclosure header={header} openLabel="Настроить" closeLabel="Свернуть">
          <div className="pt-1">{portal.settings}</div>
        </CaseDisclosure>
      ) : <div className="flex min-h-11 flex-wrap items-center gap-x-3">{header}</div>}
    </section>
  );
}

/** «Сведения» справа от 1280 px: контакты, приём дела и продажа. null — показывать нечего. */
function hasFacts(input: CaseOverviewInput): boolean {
  const handoff = input.handoff;
  const answered = handoff !== null && handoff.assignmentEventId !== null && !studentsHandoffPending(handoff);
  return Boolean(input.contacts.phone || input.contacts.email) || answered || input.sales !== null;
}

function Facts({ input }: Readonly<{ input: CaseOverviewInput }>) {
  const handoff = input.handoff;
  const answered = handoff !== null && handoff.assignmentEventId !== null && !studentsHandoffPending(handoff);
  const hasContacts = Boolean(input.contacts.phone || input.contacts.email);
  return (
    <aside aria-labelledby="case-facts-title" className="min-w-0 border-t border-border pt-4 xl:border-t-0 xl:border-s xl:ps-6 xl:pt-0" data-testid="v3-case-facts">
      <h2 id="case-facts-title" className="t-section text-fg">Сведения</h2>
      <dl className="mt-1">
        {hasContacts ? (
          <Fact term="Контакты">
            {input.contacts.phone ? <span className="block tabular-nums">{input.contacts.phone}</span> : null}
            {input.contacts.email ? <span className="block break-all">{input.contacts.email}</span> : null}
          </Fact>
        ) : null}
        {answered && handoff ? (
          <Fact term="Приём дела">
            {/* Как прежняя карточка «Приём дела»: решение, текст куратора (уточнение или причина отказа)
                и согласованный контакт — их видят и те, кто ответить не может (Admin, Admissions Manager). */}
            <HandoffResponseSummary current={handoff.current ? {
              decision: handoff.current.decision,
              clarification: handoff.current.clarification,
              agreedContactDate: handoff.current.agreedContactDate,
            } : null} />
            {handoff.canRespond ? (
              <details>
                <summary className={SUMMARY}>Изменить ответ</summary>
                <div className="mt-1"><CaseHandoffBlock snapshot={handoff} headingId="case-next-title" /></div>
              </details>
            ) : null}
          </Fact>
        ) : null}
        {input.sales ? (
          <Fact term="Продажа">
            <span className="block">{input.sales.manager ?? "Менеджер не назначен"}</span>
            {input.sales.nextAction ? <span className="block text-fg-2">{input.sales.nextAction}</span> : null}
          </Fact>
        ) : null}
      </dl>
    </aside>
  );
}

/**
 * «Обзор» дела студента — сначала работа (решение владельца 26.09.2026):
 * «Что дальше» (приём дела, открытые задачи) → «Документы» → «Переписка» →
 * «Заявки» → «Оплата» → «Заметки». Каждая часть — строка из уже прочитанных
 * данных со ссылкой на свою вкладку; формы продажи — в свёрнутом разделе
 * «Данные продажи». От 1280 px справа — «Сведения»: контакты, приём дела
 * (решение, текст куратора, согласованный контакт) и продажа.
 */
export function CaseOverview(input: CaseOverviewInput) {
  const facts = hasFacts(input);
  return (
    <div className={`grid gap-x-8 gap-y-6 ${facts ? "xl:grid-cols-[minmax(0,1fr)_18rem]" : ""}`} data-testid="v3-case-overview">
      <div className="min-w-0 space-y-5">
        <Tasks input={input} headingId="case-next-title" />
        <Documents input={input} />
        <Correspondence input={input} />
        <Applications input={input} />
        <Payment input={input} />
        <PortalAccess input={input} />
        <div className="border-t border-border pt-4">{input.notes}</div>
        {input.salesData ? (
          <details id="sales-data" open={input.salesDataOpen} className="group border-t border-border pt-2" data-testid="v3-case-sales-data">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 t-section text-fg [&::-webkit-details-marker]:hidden">
              Данные продажи
              <Icon name="chevron-down" size={18} className="text-fg-2 transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none" />
            </summary>
            <div className="mt-3 flex flex-col gap-4">{input.salesData}</div>
          </details>
        ) : null}
      </div>
      {facts ? <Facts input={input} /> : null}
    </div>
  );
}
