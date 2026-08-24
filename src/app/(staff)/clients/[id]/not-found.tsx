import Link from "next/link";

import { btnGhostCls } from "@/components/ui";

export default function CanonicalClientNotFound() {
  return (
    <div className="space-y-4 border-y border-border py-8" data-testid="canonical-client-not-found">
      <h1 className="text-[19px] font-bold text-fg">Клиент EVO не найден</h1>
      <p className="max-w-2xl text-[13px] leading-6 text-fg-3">
        Запись не существует или недоступна в вашей организации. EVO не показывает
        данные другой организации и не подставляет Student Case или диалог вместо клиента.
      </p>
      <Link href="/clients" className={btnGhostCls}>
        Вернуться к клиентам
      </Link>
    </div>
  );
}
