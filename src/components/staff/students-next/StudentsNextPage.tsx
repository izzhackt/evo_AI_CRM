"use client";

import Link from "next/link";

import { EmptyState, PageShell, SectionTabs } from "@/components/kit";
import { Button } from "@/components/ui/button";

import { studentsListHref, studentsQueueHref, studentsQueueTabs } from "../students/students-queue-view";
import type { StudentsQueueScreenInput } from "../students/StudentsQueueScreen";
import { CuratorsNext } from "./CuratorsNext";
import { StudentsQueueNext } from "./StudentsQueueNext";

const HELP_QUEUE = "Очередь дел по сроку «Следующего шага»: сверху просроченные. Строка открывает панель дела, стрелка справа — дело целиком. Поиск идёт по всей очереди, а не только по этой странице.";

function Alert({ title, description, action, testId }: Readonly<{ title: string; description?: string; action?: React.ReactNode; testId?: string }>) {
  return (
    <div role="alert" className="rounded-card border border-border bg-surface" data-testid={testId}>
      <EmptyState tone="danger" title={title} description={description} action={action} />
    </div>
  );
}

/**
 * «Студенты» в «Новом виде»: рамка страницы и один из видов — очередь, «Нагрузка кураторов» либо честный отказ (адрес не
 * разобран, сервер не пускает к очереди). Всё, что читает и решает страница, приходит готовым в `input` (те же данные, что
 * у прежнего вида); показывается через `StudentsNextLazy`.
 */
export function StudentsNextPage({ input }: Readonly<{ input: StudentsQueueScreenInput }>) {
  const { params, read } = input;
  let body: React.ReactNode;
  if (input.invalid) {
    const tabs = studentsQueueTabs(params, null, input.actor);
    body = (
      <>
        <SectionTabs label="Виды списка студентов" tabs={tabs.map(({ key, label, href, count }) => ({ key, label, href, count }))} value={params.view} />
        <Alert title="Не удалось применить фильтры." action={<Button variant="outline" asChild><Link href={studentsQueueHref(params)}>Сбросить фильтры</Link></Button>} />
      </>
    );
  } else if (read.forbidden) {
    body = <Alert testId="queue-forbidden" title="Список студентов для вашей учётной записи недоступен."
      description="Обратитесь к администратору: повторная попытка не поможет."
      action={input.actor.coverage ? <Button variant="outline" asChild><Link href={studentsListHref(params, { view: "curators" })}>Открыть «Нагрузку кураторов»</Link></Button> : undefined} />;
  } else if (params.view === "curators") {
    const tabs = studentsQueueTabs(params, read.counts, input.actor).map(({ key, label, href, count }) => ({ key, label, href, count }));
    body = (
      <>
        <SectionTabs label="Виды списка студентов" tabs={tabs} value={params.view} />
        <CuratorsNext coverage={input.coverage ?? { kind: "hidden" }} today={input.today} requestId={input.requestIds.coverage} />
      </>
    );
  } else {
    body = <StudentsQueueNext input={input} />;
  }
  return (
    <PageShell title="Студенты" testId="v3-students-next" help={HELP_QUEUE}>
      {/* Контейнер очереди для проверки выпуска (`scripts/release/evo-production-browser-smoke.mjs`): стоит в любом состоянии — очередь, отказ, ошибка. */}
      <div className="grid min-w-0 gap-4" data-testid="v3-student-case-directory">{body}</div>
    </PageShell>
  );
}
