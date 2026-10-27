import Link from "next/link";

import { EmptyState, PageShell } from "@/components/kit";
import { Button } from "@/components/ui/button";

import { RequestsNextView } from "./RequestsNextView";

/**
 * «Заявки» нового вида целиком: рамка страницы, форма и кнопка ручного лида (приходят готовыми со страницы — те же
 * клиентские части, что у прежнего вида) и очередь с панелью записи. Показывается через `RequestsNextLazy`.
 */
export function RequestsNextPage({ help, actions, children, ...view }: Readonly<{
  help: string;
  actions?: React.ReactNode;
  children?: React.ReactNode;
} & React.ComponentProps<typeof RequestsNextView>>) {
  return (
    <PageShell title="Заявки" testId="v3-requests" help={help} actions={actions}>
      {children}
      <RequestsNextView {...view} />
    </PageShell>
  );
}

/** Неверная ссылка на очередь: что не так и «Повторить» без параметров. */
export function RequestsNextInvalid() {
  return (
    <PageShell title="Заявки" testId="v3-requests">
      <div role="alert" className="rounded-card border border-border bg-surface" data-testid="queue-error">
        <EmptyState tone="danger" title="Эта ссылка на очередь заявок неверна."
          action={<Button variant="outline" asChild><Link href="/v3/requests">Повторить</Link></Button>} />
      </div>
    </PageShell>
  );
}
