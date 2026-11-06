import { PageShell } from "@/components/kit";
import { QueueSkeleton } from "@/components/staff/queue/QueueStates";

/** Загрузка «Шаблонов ответов» — форма списка, чтобы клик по пункту меню отвечал сразу. */
export default function ReplySnippetsLoading() {
  return (
    <PageShell title="Шаблоны ответов" testId="v3-reply-snippets-next">
      <QueueSkeleton head={false} leading={false} label="Загружаем шаблоны ответов…" />
    </PageShell>
  );
}
