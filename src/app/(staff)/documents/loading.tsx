import { PageShell } from "@/components/kit";
import { QueueSkeleton } from "@/components/staff/queue/QueueStates";

/** Загрузка «Документов» — форма списка, чтобы клик по пункту меню отвечал сразу, а не после чтения. */
export default function DocumentsLoading() {
  return (
    <PageShell title="Документы" testId="v3-documents-next">
      <QueueSkeleton head={false} leading={false} label="Загружаем документы…" />
    </PageShell>
  );
}
