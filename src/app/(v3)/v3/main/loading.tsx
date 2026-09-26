import { PartShell } from "@/components/v3/PartShell";
import { QueueSkeleton } from "@/components/v3/queue/QueueStates";

/** Загрузка «Сегодня» — форма очереди: волосяные строки без вкладок и инструментов. */
export default function MainLoading() {
  return (
    <PartShell title="Сегодня">
      <QueueSkeleton head={false} label="Загружаем очередь на сегодня…" />
    </PartShell>
  );
}
