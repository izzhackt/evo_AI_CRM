import { KeyFacts, StatTile, WidgetCard } from "@/components/kit";
import type { GateFacts } from "@/components/v3/settings/types";

/** «Документы и передача»: правила загрузки файлов и условия передачи в приёмную, плитки — по настоящим подсчётам. */
export function DocumentsNext({ gates }: Readonly<{ gates: GateFacts }>) {
  return (
    <div className="grid min-w-0 gap-4" data-testid="v3-settings-documents">
      <WidgetCard
        headingLevel={3}
        title="Правила загрузки"
        help="Скачивание доступно после проверки целостности и безопасности файла."
      >
        <KeyFacts columns={3} facts={[
          { label: "Разрешённые типы", value: "PDF, JPEG, PNG" },
          { label: "Предельный размер", value: "25 МиБ" },
          { label: "Кто видит", value: "Только пользователи с нужными правами. Публичного доступа нет." },
        ]} />
      </WidgetCard>
      <WidgetCard
        headingLevel={3}
        title="Условия передачи в приёмную"
        help="Финансовый стоп блокирует подачу заявки в вуз и этап визы «Подача». Установить его может приёмная, снять — только администратор."
      >
        <div className="grid gap-4">
          <p className="t-body-compact text-fg">
            Передать в приёмную можно после подтверждения договора <em>и</em> первого платежа. Исключение может подтвердить только
            администратор с указанием причины. Учитывается последнее подтверждение по лиду.
          </p>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatTile label="Передач" value={gates.handoffs} />
            <StatTile label="Исключений" value={gates.overrides} />
            <StatTile label="Подтверждений" value={gates.evidence} />
            <StatTile label="Финансовых стопов" value={gates.financeStops} />
          </div>
        </div>
      </WidgetCard>
    </div>
  );
}
