import type { ReactNode } from "react";

import { AppShell } from "@/components/v3/AppShell";

import "./v3.css";

/**
 * Оболочка V3.
 *
 * Токены переопределяются здесь, а не в компонентах: части написаны на именах
 * `--surface`, `--text`, `--accent`, поэтому смена мира — это смена значений в
 * одном месте, а не правка каждого экрана. Основное приложение (V2) не
 * затронуто: переопределение живёт внутри `.v3-world`.
 *
 * Навигация тоже здесь: части перестали быть каталогом и стали одним
 * интерфейсом, а значит разделы должны быть на месте на каждом экране.
 */
export default function V3Layout({ children }: { children: ReactNode }) {
  return (
    <div className="v3-world">
      <AppShell>{children}</AppShell>
    </div>
  );
}
