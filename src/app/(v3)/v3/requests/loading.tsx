import { PartShell } from "@/components/v3/PartShell";
import { QueueSkeleton } from "@/components/v3/queue/QueueStates";

/** Загрузка «Заявок» — форма очереди: вкладки, строка состояния и волосяные строки (Э3). */
export default function RequestsLoading() {
  return (
    <PartShell title="Заявки" dense>
      <QueueSkeleton label="Загружаем заявки…" leading={false} />
    </PartShell>
  );
}
