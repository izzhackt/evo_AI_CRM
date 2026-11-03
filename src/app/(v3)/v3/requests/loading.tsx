import { PageShell } from "@/components/kit";
import { QueueSkeleton } from "@/components/v3/queue/QueueStates";

/** Загрузка «Заявок» — форма очереди: вкладки, строка состояния и волосяные строки (Э3). */
export default function RequestsLoading() {
  return (
    <PageShell title="Заявки">
      <QueueSkeleton label="Загружаем заявки…" leading={false} />
    </PageShell>
  );
}
