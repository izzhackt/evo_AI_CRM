import type { ReactNode } from "react";

import { KeyFacts, type KeyFact } from "@/components/kit/KeyFacts";

import { CaseTaskList } from "../CaseTaskList";
import { CaseHelpNoAccess, FeedItem, Groups, caseFactValues, type CaseOverviewInput } from "../CaseOverview";
import { CASE_FACTS_ID, type CaseFeedItem } from "../case-work-view";
import { FeedCard, FeedPager } from "./FeedCard";
import { ApplicationsValue } from "./CaseApplications";
import { NamedCard } from "./NamedCard";

type Values = ReturnType<typeof caseFactValues>;
type Props = Readonly<{ input: CaseOverviewInput; values: Values }>;

/** «Задачи»: открытые задачи дела строками «Задач» (выполнение на месте, перенос, передача) - те же команды и права. */
function TasksCard({ input }: Readonly<{ input: CaseOverviewInput }>) {
  const { work } = input;
  return (
    <NamedCard
      title="Задачи"
      id="case-tasks"
      titleId="case-tasks-title"
      testId="v3-case-tasks-part"
      count={work.tasks.kind === "ready" ? work.tasks.tasks.length : null}
    >
      {work.tasks.kind === "forbidden" ? (
        <p className="t-body-compact text-fg-2" data-testid="v3-case-tasks-forbidden">Нет доступа к задачам этого дела.</p>
      ) : work.tasks.kind === "unavailable" ? (
        <p role="alert" className="t-body-compact text-danger">Не удалось загрузить задачи. Обновите страницу, чтобы повторить.</p>
      ) : work.tasks.tasks.length === 0 ? (
        <p className="t-body-compact text-fg-3">Открытых задач нет.</p>
      ) : (
        <CaseTaskList tasks={work.tasks.tasks} permissions={input.taskPermissions} nowIso={work.nowIso} />
      )}
    </NamedCard>
  );
}

/** «Лента» дела: заметки и события новые сверху; старые строки - панелью «Ещё N», срез журнала - строкой-указателем. */
function CaseFeedCard({ input }: Readonly<{ input: CaseOverviewInput }>) {
  const { items, eventsUnavailable } = input.feed;
  const key = (item: CaseFeedItem, index: number) => (item.kind === "event" ? item.key : `${item.kind}:${item.at}:${index}`);
  const rows = items.map((item, index) => (
    <FeedItem key={key(item, index)} item={item} today={input.work.today} historyHref={input.hrefs.history} />
  ));
  const notice = input.work.activity?.kind === "forbidden" ? (
    <p className="t-body-compact text-fg-2" data-testid="v3-case-feed-forbidden">Нет доступа к журналу этого дела.</p>
  ) : eventsUnavailable ? (
    <p className="t-body-compact text-fg-2" data-testid="v3-case-feed-unread">События журнала дела сейчас не прочитаны. Обновите страницу, чтобы повторить.</p>
  ) : null;
  return (
    <FeedCard
      id="case-feed"
      testId="v3-case-feed"
      listTestId="v3-case-feed-items"
      notices={notice}
      composer={input.noteComposer}
      rows={rows}
      empty="Заметок и событий пока нет."
      footer={<FeedPager olderHref={input.notesOlderHref} latestHref={input.notesLatestHref} />}
    />
  );
}

/**
 * «Сведения» справа: куратор и направление (со сменой - прежние действия), документы и оплата подробно, контакты, кто передал,
 * продажа, приём дела, заявки, переписка, ИИ-помощники, портал. В шапке дела (06.11.2026) остались этап, «Что дальше» и одна
 * строка «Документы 0/21 · Оплата 50%».
 */
function FactsCard({ input, values }: Props) {
  const facts: KeyFact[] = [
    { label: "Куратор", value: values.curator },
    { label: "Направление", value: values.direction },
    { label: "Документы", value: values.documents },
    { label: "Оплата", value: values.payment },
    { label: "Контакты", value: values.contacts },
    { label: "Передал", value: values.handedOff },
    { label: "Менеджер продаж", value: values.sales },
    { label: "Приём дела", value: values.reception },
    { label: "Заявки", value: <ApplicationsValue input={input} /> },
    { label: "Переписка", value: values.chat },
    { label: "ИИ-помощники", value: values.aiConsent },
    { label: "Портал", value: values.portal },
  ];
  return (
    <NamedCard title="Сведения" id={CASE_FACTS_ID} testId="v3-case-facts">
      <KeyFacts facts={facts} columns={1} className="gap-y-4" />
    </NamedCard>
  );
}

/** Доступ к порталу и данные продажи: прежние группы правки, свёрнутые (адрес с якорем раскрывает нужную). */
function GroupsCard({ input }: Readonly<{ input: CaseOverviewInput }>): ReactNode {
  if (!input.portal?.settings && !input.salesData) return null;
  return (
    <NamedCard title="Продажа и портал" id="case-groups" testId="v3-case-groups-card" className="@container">
      <Groups input={input} bare />
    </NamedCard>
  );
}

/** «Обращения студента»: карточка с заголовком, как соседние; чтение, счёт и ответы - прежняя панель (`card`). */
function HelpCard({ input }: Readonly<{ input: CaseOverviewInput }>): ReactNode {
  if (input.helpNoAccess) return <CaseHelpNoAccess card />;
  return input.help;
}

/**
 * «Обзор» дела в «Новом виде». От 1280 px слева работа - «Задачи», «Обращения студента», «Лента», группы правки;
 * справа «Сведения». До этого: задачи, сведения, лента, группы - порядок прежнего вида.
 */
export function CaseNextOverview({ input, values }: Props) {
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_22rem] xl:grid-rows-[auto_1fr]" data-testid="v3-case-overview">
      <div className="grid min-w-0 grid-cols-1 content-start gap-4 xl:col-start-1 xl:row-start-1">
        <TasksCard input={input} />
        <HelpCard input={input} />
      </div>
      <div className="min-w-0 xl:col-start-2 xl:row-span-2 xl:row-start-1">
        <FactsCard input={input} values={values} />
      </div>
      <div className="grid min-w-0 grid-cols-1 content-start gap-4 xl:col-start-1 xl:row-start-2">
        <CaseFeedCard input={input} />
        <GroupsCard input={input} />
      </div>
    </div>
  );
}
