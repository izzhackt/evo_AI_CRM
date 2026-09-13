import type { ReactNode } from "react";
import { isStaffPreview } from "@/lib/platform-access";

import { AppShell } from "@/components/v3/AppShell";
import { requirePlatformStaffActor } from "@/lib/platform-guards";
import { readStaffNotificationsForActor } from "@/lib/v3/staff-notification-source";

import "./v3.css";

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
  const notifications = !isStaffPreview(actor)
    ? await readStaffNotificationsForActor(actor).catch(() => null)
    : null;

  return (
    <div className="v3-world">
      <AppShell
        actor={actor}
        initialNotifications={notifications}
      >
        {children}
      </AppShell>
    </div>
  );
}
