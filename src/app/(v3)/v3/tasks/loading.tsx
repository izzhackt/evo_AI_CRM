import { PartShell } from "@/components/v3/PartShell";
import { QueueSkeleton } from "@/components/v3/queue/QueueStates";

export default function TasksLoading() {
  return <PartShell title="Задачи"><QueueSkeleton /></PartShell>;
}
