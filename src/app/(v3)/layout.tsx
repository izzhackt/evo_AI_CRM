import type { Metadata } from "next";
import type { ReactNode } from "react";
import { isStaffPreview } from "@/lib/platform-access";

import { AppShell } from "@/components/v3/AppShell";
import { requirePlatformStaffActor } from "@/lib/platform-guards";
import { readStaffNotificationsForActor } from "@/lib/v3/staff-notification-source";

import "./v3.css";
import "./ai-agent.css";

/**
 * Один вид вкладки браузера для всего staff CRM: «<Раздел> — EVO CRM».
 * Страница задаёт только название раздела — подпись подсвеченного пункта
 * меню. Next.js применяет `template` к дочерним сегментам этой группы вместо
 * шаблона корневого layout; `absolute` — вкладка экрана без своего названия
 * (`default` прошёл бы через корневой шаблон «… | EVO Admissions CRM»).
 */
export const metadata: Metadata = {
  title: { absolute: "EVO CRM", template: "%s — EVO CRM" },
};

/**
 * Оболочка V3.
 *
 * Токены переопределяются здесь, а не в компонентах: части написаны на именах
 * `--surface`, `--text`, `--accent`, поэтому смена мира — это смена значений в
 * одном месте, а не правка каждого экрана. `data-surface="staff"` — корень
 * staff CRM: облик сотрудников (`.v3-world[data-surface="staff"]` в v3.css,
 * Э1.5) действует только под ним. Кабинет студента тоже рисует экраны в
 * `.v3-world`, но без этого атрибута, и живёт базовыми значениями.
 *
 * Навигация тоже здесь: части перестали быть каталогом и стали одним
 * интерфейсом, а значит разделы должны быть на месте на каждом экране.
 */
export default async function V3Layout({ children }: { children: ReactNode }) {
  const actor = await requirePlatformStaffActor();
  const notifications = !isStaffPreview(actor) ? await readStaffNotificationsForActor(actor).catch(() => null) : null;

  return (
    <div className="v3-world" data-surface="staff">
      <AppShell actor={actor} initialNotifications={notifications}>
        {children}
      </AppShell>
    </div>
  );
}
