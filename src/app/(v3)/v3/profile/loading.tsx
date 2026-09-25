import { PartShell } from "@/components/v3/PartShell";
import { QueueSkeleton } from "@/components/v3/queue/QueueStates";

/** Загрузка «Студентов» — форма очереди: вкладки, строка инструментов и волосяные строки. */
export default function ProfileLoading() {
  return <PartShell title="Студенты" dense><QueueSkeleton label="Загружаем список студентов…" leading={false} /></PartShell>;
}
