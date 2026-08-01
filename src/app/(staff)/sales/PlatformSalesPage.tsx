import {
  ContextBanner,
  KeyValueGrid,
} from "@/components/platform/operations/OperationsPrimitives";
import { Badge, Card, PageHeader } from "@/components/ui";
import { getPlatformOpWorkflowContract } from "@/lib/platform-admissions";
import { requirePlatformSalesActor } from "@/lib/platform-guards";

const STAGE_COPY: Record<string, string> = {
  new: "Новый запрос",
  contacting: "Первичный контакт",
  qualified: "Квалифицирован",
  meeting_scheduled: "Встреча назначена",
  meeting_completed: "Встреча проведена",
  potential: "Потенциальный клиент",
  contract_signed: "Договор подписан",
  no_answer: "Нет ответа",
  meeting_not_attended: "Не пришёл на встречу",
  won: "Успешно завершено",
  lost: "Закрыто без договора",
};

function workflowLabel(key: string): string {
  return STAGE_COPY[key] ?? key.replaceAll("_", " ");
}

export default async function PlatformSalesPage() {
  const actor = await requirePlatformSalesActor();
  const workflow = await getPlatformOpWorkflowContract(actor);

  return (
    <div className="space-y-5" data-testid="platform-sales-page">
      <PageHeader
        eyebrow="OP · продажи"
        title="Контур продаж"
        description="amoCRM остаётся источником контактов, сделок, ответственного менеджера и этапа продаж. EVO Platform показывает только утверждённый рабочий контракт."
      />

      <ContextBanner
        tone="warning"
        title="amoCRM пока не подключена к этому окружению"
        description="Живые сделки и изменения этапов скрыты до проверенного подключения адаптера. Здесь нет тестовых лидов и локальной подмены данных."
      />

      {workflow ? (
        <>
          <Card title="Утверждённый путь OP">
            <ol aria-label="Этапы продаж OP" className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {workflow.stageKeys.map((stage, index) => (
                <li
                  key={stage}
                  className="rounded-nav border border-border bg-surface-2 px-3 py-2.5 text-[12px] font-semibold text-fg-2"
                >
                  <span className="mr-2 font-mono text-[10px] text-fg-3">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  {workflowLabel(stage)}
                </li>
              ))}
            </ol>
          </Card>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card title="Контрольные исходы">
              <div className="space-y-4">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-fg-3">
                    Follow-up, не этапы
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {workflow.followUpOutcomeKeys.map((item) => (
                      <Badge key={item} value="pending" label={workflowLabel(item)} />
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-fg-3">
                    Результат закрытия
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {workflow.closureResultKeys.map((item) => (
                      <Badge
                        key={item}
                        value={item === "won" ? "approved" : "rejected"}
                        label={workflowLabel(item)}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </Card>

            <Card title="Версия контракта">
              <KeyValueGrid
                items={[
                  { label: "Ключ", value: workflow.contractKey },
                  { label: "Версия", value: `v${workflow.version}` },
                  { label: "Статус", value: "Утверждён" },
                  {
                    label: "Утверждено",
                    value: new Date(workflow.approvedAt).toLocaleString("ru-RU"),
                  },
                ]}
              />
            </Card>
          </div>
        </>
      ) : (
        <ContextBanner
          tone="danger"
          title="Рабочий контракт OP не утверждён"
          description="Продажи остаются заблокированы до публикации одной утверждённой версии процесса."
        />
      )}
    </div>
  );
}
