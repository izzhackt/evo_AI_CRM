import Link from "next/link";

import { Icon } from "@/components/icons";
import { PageShell } from "@/components/kit";
import { PipelineBoardNext } from "@/components/staff/pipeline-next/PipelineBoardNext";

/**
 * «Воронка продаж» нового вида целиком: рамка страницы (число в работе рядом с названием, «Добавить лида» справа), форма
 * ручного лида и строка инструментов приходят готовыми со страницы (те же клиентские части, что у прежней доски), ниже вкладки
 * этапов, колонки и панель лида. Показывается через `PipelineNextLazy`.
 */
export function PipelineNextPage({ count, actions, form, toolbar, notes, ...board }: Readonly<{
  count: number | null;
  actions?: React.ReactNode;
  form?: React.ReactNode;
  toolbar: React.ReactNode;
  notes?: React.ReactNode;
} & Omit<React.ComponentProps<typeof PipelineBoardNext>, "allCount">>) {
  return (
    <PageShell title="Воронка продаж" count={count} testId="v3-pipeline" actions={actions}>
      {form}
      {toolbar}
      {notes}
      <PipelineBoardNext {...board} allCount={count} />
    </PageShell>
  );
}

/** «Закрытые лиды» нового вида: рамка с возвратом к доске, список приходит готовым (прежний `ClosedLeadsList`). */
export function PipelineClosedNextPage({ title, count, backLabel, children }: Readonly<{
  title: string;
  count: number | null;
  backLabel: string;
  children: React.ReactNode;
}>) {
  return (
    <PageShell title={title} count={count} testId="v3-pipeline-closed"
      back={
        <Link href="/pipeline" className="mb-2 inline-flex min-h-11 items-center gap-1.5 t-label text-fg-2 hover:text-fg hover:underline hover:underline-offset-4">
          <Icon name="arrow-left" size={16} />
          {backLabel}
        </Link>
      }>
      {children}
    </PageShell>
  );
}

/**
 * Просмотр роли: проекция передач отказывает ему, а без неё переданные лиды легли бы в рабочие колонки. Доски нет,
 * как у «Динамики» и «Сегодня»; «Закрытые лиды» читаются и в просмотре (только чтение).
 */
export function PipelinePreviewNextPage({ closedHref, closedLabel }: Readonly<{ closedHref: string; closedLabel: string }>) {
  return (
    <PageShell title="Воронка продаж" testId="v3-pipeline">
      <p className="py-4 t-body-compact text-fg-2" data-testid="v3-pipeline-preview">При просмотре роли воронка не показывается.</p>
      <Link href={closedHref} prefetch={false} data-testid="v3-pipeline-closed-link"
        className="inline-flex min-h-11 items-center t-label text-fg-2 underline underline-offset-4 hover:text-fg">
        {closedLabel}
      </Link>
    </PageShell>
  );
}
