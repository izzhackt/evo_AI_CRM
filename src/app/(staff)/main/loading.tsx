import { PageShell } from "@/components/kit";
import { QueueSkeleton } from "@/components/staff/queue/QueueStates";

/** Загрузка «Сегодня» — форма очереди: волосяные строки без вкладок и инструментов. */
export default function MainLoading() {
  return (
    <PageShell title="Сегодня">
      <QueueSkeleton head={false} label="Загружаем очередь на сегодня…" />
    </PageShell>
  );
}
