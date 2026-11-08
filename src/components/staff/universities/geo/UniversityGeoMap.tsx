"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ComponentType } from "react";

import type { UniversityMapPin } from "@/lib/portal/universities";

import type { UniversityGeoMapCanvasProps } from "./UniversityGeoMapCanvas";

/**
 * Карта страны в CRM: холст MapLibre подгружается только в браузере (без
 * SSR), как у кабинета студента. Не загрузился чанк, WebGL или тайлы: явная
 * ошибка со ссылкой на список, а не пустая рамка.
 */
export function UniversityGeoMap({ pins, listHref }: Readonly<{ pins: readonly UniversityMapPin[]; listHref: string }>) {
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [Canvas, setCanvas] = useState<ComponentType<UniversityGeoMapCanvasProps> | null>(null);

  useEffect(() => {
    let disposed = false;
    import("./UniversityGeoMapCanvas").then(
      (module) => { if (!disposed) setCanvas(() => module.UniversityGeoMapCanvas); },
      () => { if (!disposed) setStatus("failed"); },
    );
    return () => { disposed = true; };
  }, []);

  const ready = useCallback(() => setStatus("ready"), []);
  const fail = useCallback(() => setStatus("failed"), []);

  return (
    <div
      role="region"
      aria-label="Карта кампусов"
      data-testid="university-geo-map"
      className="relative h-[min(70vh,640px)] min-h-[360px] overflow-hidden rounded-card border border-border bg-surface-2"
    >
      {Canvas !== null && status !== "failed" ? <Canvas pins={pins} onReady={ready} onFail={fail} /> : null}
      {status === "loading" ? (
        <p role="status" className="absolute inset-0 z-10 grid place-items-center t-body-compact text-fg-2">Загружаем карту…</p>
      ) : null}
      {status === "failed" ? (
        <div role="alert" className="absolute inset-0 z-10 grid place-content-center justify-items-center gap-3 p-6 text-center">
          <p className="t-body-compact text-fg">Не удалось загрузить карту. Университеты страны доступны списком.</p>
          <Link href={listHref} className="inline-flex h-11 items-center rounded-ctl border border-border bg-surface px-4 t-label text-fg hover:bg-surface-2">Открыть список</Link>
        </div>
      ) : null}
    </div>
  );
}
