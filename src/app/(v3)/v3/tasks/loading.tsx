import { PartShell } from "@/components/v3/PartShell";

export default function TasksLoading() {
  return <PartShell title="Задачи"><p role="status" className="text-sm text-fg-2">Загружаем задачи…</p></PartShell>;
}
