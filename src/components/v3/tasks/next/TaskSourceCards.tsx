import Link from "next/link";

import { EmptyState, KeyFacts, StatusBadge, WidgetCard } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { callerDisplayName, taskStatus } from "@/lib/v3/wording";

import { NewTaskButton } from "./NewTaskButton";

type Composer = React.ComponentProps<typeof NewTaskButton>["composer"];

/** Сообщение команды, из которого создаётся задача: текст сообщения и возврат к нему. Доступ к каналу задача не меняет — это за «?». */
export function TaskMessageCard({ message }: Readonly<{ message: Readonly<{ id: string; channelKey: string; authorName: string; body: string }> }>) {
  return (
    <WidgetCard
      title={`Задача из сообщения · ${message.authorName}`}
      help="Проверьте название и исполнителя. Доступ к каналу не меняется."
      footer={<Button variant="link" asChild><Link href={`/v3/team-chat?channel=${message.channelKey}&message=${message.id}`}>Вернуться к сообщению</Link></Button>}
    >
      <p className="whitespace-pre-wrap break-words t-body-compact">{message.body}</p>
    </WidgetCard>
  );
}

export type TaskLeadCardData = Readonly<{
  leadId: string;
  clientDisplayName: string | null;
  nextActionText: string | null;
  nextActionDueDate: string | null;
  canOpenPipeline: boolean;
}>;

/** «Задачи по лиду»: клиент, следующее действие воронки, «Новая задача по лиду» и связанные рабочие задачи (последние 50). */
export function TaskLeadCards({ lead, links, composer, urlIntent }: Readonly<{
  lead: TaskLeadCardData;
  links: Readonly<{ rows: readonly Readonly<{ id: string; title: string; status: string }>[]; truncated: boolean }> | null;
  composer: Composer;
  urlIntent: string | null;
}>) {
  const name = lead.clientDisplayName ?? "Имя клиента не указано";
  const pipeline = lead.clientDisplayName === "Имя клиента не указано" ? "/v3/pipeline" : `/v3/pipeline?q=${encodeURIComponent(lead.clientDisplayName ?? "")}`;
  return (
    <>
      <WidgetCard
        title={callerDisplayName(name)}
        actions={<NewTaskButton key={lead.leadId} composer={composer} urlIntent={urlIntent} showButton label="Новая задача по лиду" variant="outline" />}
      >
        <KeyFacts columns={2} facts={[
          { label: "Следующее действие воронки", value: lead.nextActionText ?? "Не назначено" },
          { label: "Срок", value: lead.nextActionDueDate },
        ]} />
        {lead.canOpenPipeline ? <Button variant="link" asChild className="mt-2"><Link href={pipeline}>Открыть в воронке</Link></Button> : null}
      </WidgetCard>
      <WidgetCard title="Связанные рабочие задачи" footer={<Button variant="link" asChild><Link href="/v3/tasks">Все мои задачи</Link></Button>}>
        {links?.rows.length ? (
          <ul className="divide-y divide-border">
            {links.rows.map((task) => (
              <li key={task.id}>
                <Link href={`/v3/tasks?task=${task.id}`} className="flex min-h-11 flex-wrap items-center justify-between gap-2 py-2 t-body-compact">
                  <span className="break-words underline">{task.title}</span>
                  <StatusBadge label={taskStatus(task.status) ?? task.status} tone={task.status === "blocked" ? "warn" : "neutral"} />
                </Link>
              </li>
            ))}
          </ul>
        ) : <EmptyState title="Связанных задач нет." />}
        {links?.truncated ? <p className="mt-2 t-body-compact text-fg-2">Показаны последние 50.</p> : null}
      </WidgetCard>
    </>
  );
}
