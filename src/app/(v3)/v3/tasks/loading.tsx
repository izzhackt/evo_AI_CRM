import { PageShell } from "@/components/kit";
import { QueueSkeleton } from "@/components/v3/queue/QueueStates";

export default function TasksLoading() {
  return <PageShell title="Задачи"><QueueSkeleton /></PageShell>;
}
