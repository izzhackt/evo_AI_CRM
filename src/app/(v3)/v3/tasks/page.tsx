import { PartShell } from "@/components/v3/PartShell";
import { TaskQueue } from "@/components/v3/TaskQueue";
import { readTaskQueue } from "@/lib/v3/tasks-source";

export const dynamic = "force-dynamic";
export const metadata = { title: "V3 · Задачи" };

export default async function TasksPart() {
  const tasks = await readTaskQueue();

  return (
    <PartShell
      title="Задачи"
      count={tasks.length}
      width="narrow"
      lead="Очередь приёмной кампании из канонической PostgreSQL, разбитая по срочности. Галочка отмечает задачу выполненной только на экране — записи в базу здесь нет."
    >
      <TaskQueue tasks={tasks} />
    </PartShell>
  );
}
