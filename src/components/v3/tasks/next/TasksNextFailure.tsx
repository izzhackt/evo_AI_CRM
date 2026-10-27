import Link from "next/link";

import { EmptyState, PageShell, WidgetCard } from "@/components/kit";
import { Button } from "@/components/ui/button";

/** Ошибка чтения: что не получилось и «Повторить» тем же адресом. Остаётся на виду — это сбой, а не пояснение. */
export function TasksNextFailure({ text, retryHref }: Readonly<{ text: string; retryHref: string }>) {
  return (
    <PageShell title="Задачи" testId="v3-tasks-next">
      <WidgetCard>
        <div role="alert" data-testid="queue-error">
          <EmptyState tone="danger" title={text} action={<Button variant="outline" asChild><Link href={retryHref}>Повторить</Link></Button>} />
        </div>
      </WidgetCard>
    </PageShell>
  );
}
