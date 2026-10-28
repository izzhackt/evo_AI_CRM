import { EmptyState } from "@/components/kit";

const TITLES = { people: "Сотрудники", roles: "Роли и доступ", departments: "Отделы" } as const;

/** Список сотрудников не прочитан: слова остаются на виду (проверить подключение, сеанс администратора и миграцию рабочего пространства). */
export function StaffUnavailable({ view }: Readonly<{ view: keyof typeof TITLES }>) {
  return (
    <div role="alert" className="rounded-card border border-border bg-surface" data-testid="v3-settings-staff-unavailable">
      <EmptyState tone="danger" title={`${TITLES[view]}: список недоступен`} description="Проверьте подключение, сеанс администратора и применение миграции рабочего пространства." />
    </div>
  );
}
