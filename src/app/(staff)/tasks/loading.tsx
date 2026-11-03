import { PageShell } from "@/components/kit";
import { QueueSkeleton } from "@/components/staff/queue/QueueStates";

export default function TasksLoading() {
  return <PageShell title="Задачи"><QueueSkeleton /></PageShell>;
}
