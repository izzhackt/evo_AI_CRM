import type { Metadata } from "next";
import type { ReactNode } from "react";
import { isStaffPreview } from "@/lib/platform-access";

import { AppShell } from "@/components/v3/AppShell";
import { requirePlatformStaffActor } from "@/lib/platform-guards";
import { readLookPreview } from "@/lib/v3/look-preview";
import { readStaffNotificationsForActor } from "@/lib/v3/staff-notification-source";

import "./v3.css";

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
 * одном месте, а не правка каждого экрана. Переопределение живёт внутри
 * `.v3-world`, который теперь является единственной продуктовой оболочкой.
 *
 * Навигация тоже здесь: части перестали быть каталогом и стали одним
 * интерфейсом, а значит разделы должны быть на месте на каждом экране.
 */
export default async function V3Layout({ children }: { children: ReactNode }) {
  const actor = await requirePlatformStaffActor();
  const [notifications, lookPreview] = await Promise.all([
    !isStaffPreview(actor) ? readStaffNotificationsForActor(actor).catch(() => null) : Promise.resolve(null),
    // Предпросмотр нового облика (Э1.1, временно до решения владельца): только
    // Admin, в том числе в просмотре роли (Э1.2). Облик решает и оболочку.
    readLookPreview(actor),
  ]);

  return (
    <div className="v3-world" data-look={lookPreview ? "next" : undefined}>
      <AppShell
        actor={actor}
        initialNotifications={notifications}
        look={lookPreview ? "next" : undefined}
      >
        {children}
      </AppShell>
    </div>
  );
}
