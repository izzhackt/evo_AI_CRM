"use client";

import Link from "next/link";

import { EmptyState, PageShell, SectionTabs } from "@/components/kit";
import { Button } from "@/components/ui/button";

import { studentsDocsTabs, studentsListHref, studentsQueueHref, studentsQueueTabs, type DocsQueuesShown } from "../students/students-queue-view";
import type { StudentsQueueScreenInput } from "../students/StudentsQueueScreen";
import { CuratorsNext } from "./CuratorsNext";
import { DocsNext } from "./DocsNext";
import { StudentsQueueNext } from "./StudentsQueueNext";

const HELP_QUEUE = "Очередь дел по сроку «Следующего шага»: сверху просроченные. Строка открывает панель дела, стрелка справа — дело целиком. Поиск идёт по всей очереди, а не только по этой странице.";
const HELP_DOCS = "Один центр проверки документов: документы дел, документы программ и комплекты. Строка ведёт к документам дела. Поиск идёт по всем делам вкладки.";

function Alert({ title, description, action }: Readonly<{ title: string; description?: string; action?: React.ReactNode }>) {
  return (
    <div role="alert" className="rounded-card border border-border bg-surface">
      <EmptyState tone="danger" title={title} description={description} action={action} />
    </div>
  );
}

/**
 * «Студенты» и EVO Docs в «Новом виде»: рамка страницы и один из видов — очередь, EVO Docs, «Нагрузка кураторов» либо честный
 * отказ (адрес не разобран, сервер не пускает к очереди). Всё, что читает и решает страница, приходит готовым в `input`
 * (те же данные, что у прежнего вида); показывается через `StudentsNextLazy`.
 */
export function StudentsNextPage({ input, manageUniversities }: Readonly<{ input: StudentsQueueScreenInput; manageUniversities: boolean }>) {
  const { params, read } = input;
  const docs = params.mode === "docs";
  const shown: DocsQueuesShown = { program: (input.program?.kind ?? "hidden") !== "hidden", packages: (input.packages?.kind ?? "hidden") !== "hidden" };
  let body: React.ReactNode;
  if (input.invalid) {
    const tabs = docs ? studentsDocsTabs(params, { review: null, program: null, packages: null, fix: null, missing: null, all: null }, shown) : studentsQueueTabs(params, null, input.actor);
    body = (
      <>
        <SectionTabs label="Виды списка студентов" tabs={tabs.map(({ key, label, href, count }) => ({ key, label, href, count }))} value={params.view} />
        <Alert title="Не удалось применить фильтры." action={<Button variant="outline" asChild><Link href={studentsQueueHref(params)}>Сбросить фильтры</Link></Button>} />
      </>
    );
  } else if (read.forbidden) {
    const coverage = !docs && input.actor.coverage;
    body = <Alert title={docs ? "Очередь EVO Docs для вашей учётной записи недоступна." : "Список студентов для вашей учётной записи недоступен."}
      description="Обратитесь к администратору: повторная попытка не поможет."
      action={coverage ? <Button variant="outline" asChild><Link href={studentsListHref(params, { view: "curators" })}>Открыть «Нагрузку кураторов»</Link></Button> : undefined} />;
  } else if (docs) {
    body = <DocsNext input={input} />;
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
    <PageShell
      title={docs ? "EVO Docs" : "Студенты"}
      testId="v3-students-next"
      help={docs ? HELP_DOCS : HELP_QUEUE}
      actions={docs && manageUniversities ? <Button variant="outline" asChild><Link href="/v3/universities">Университеты и бланки</Link></Button> : undefined}
    >
      {body}
    </PageShell>
  );
}
