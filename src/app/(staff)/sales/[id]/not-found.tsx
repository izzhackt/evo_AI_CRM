import Link from "next/link";

import { btnGhostCls } from "@/components/ui";

export default function CanonicalLeadNotFound() {
  return (
    <div className="space-y-4 border-y border-border py-8" data-testid="canonical-lead-not-found">
      <h1 className="text-xl font-bold text-fg">Лид EVO не найден</h1>
      <p className="max-w-[60ch] text-sm leading-6 text-fg-3">
        Запись не существует или недоступна в вашей организации. EVO не показывает
        данные другой организации и не подставляет историческую сделку или диалог.
      </p>
      <Link href="/sales" className={btnGhostCls}>
        Вернуться к лидам
      </Link>
    </div>
  );
}
