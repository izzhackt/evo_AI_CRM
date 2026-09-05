import type { ReactNode } from "react";

import { AppShell } from "@/components/v3/AppShell";
import { requirePlatformStaffActor } from "@/lib/platform-guards";

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

  return (
    <div className="v3-world">
      <AppShell
        displayName={actor.displayName}
        authorityRole={actor.authorityRole}
        presentationRole={actor.presentationRole}
      >
        {children}
      </AppShell>
    </div>
  );
}
