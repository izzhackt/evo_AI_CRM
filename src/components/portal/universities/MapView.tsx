"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ComponentType } from "react";

import type { PortalStrings } from "@/lib/portal/i18n";
import type { UniversityMapPin } from "@/lib/portal/universities";

import type { MapCanvasProps } from "./MapCanvas";

/**
 * Клиентская обёртка карты (PORT-3a): MapLibre загружается динамически и
 * только в браузере (без SSR); неудачная загрузка чанка или тайлов — явное
 * состояние ошибки, список остаётся полноценным представлением (план §6).
 */

export type UniversitiesMapStrings = Pick<
  PortalStrings<"universities">,
  "mapAria" | "mapLoading" | "mapFailed" | "mapOpenCard" | "mapCloseCard" | "viewList"
>;

export function UniversitiesMapView({
  pins,
  base,
  listHref,
  strings,
}: {
  pins: readonly UniversityMapPin[];
  base: string;
  listHref: string;
  strings: UniversitiesMapStrings;
}) {
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [Canvas, setCanvas] = useState<ComponentType<MapCanvasProps> | null>(null);

  useEffect(() => {
    let disposed = false;
    import("./MapCanvas").then(
      (module) => {
        if (!disposed) setCanvas(() => module.MapCanvas);
      },
      () => {
        if (!disposed) setStatus("failed");
      },
    );
    return () => {
      disposed = true;
    };
  }, []);

  const handleReady = useCallback(() => setStatus("ready"), []);
  const handleFail = useCallback(() => setStatus("failed"), []);

  return (
    <div className="pt-map-wrap" role="region" aria-label={strings.mapAria}>
      {Canvas !== null && status !== "failed" ? (
        <Canvas
          pins={pins}
          base={base}
          strings={strings}
          onReady={handleReady}
          onFail={handleFail}
        />
      ) : null}
      {status === "loading" ? (
        <p className="pt-map-status" role="status">{strings.mapLoading}</p>
      ) : null}
      {status === "failed" ? (
        <div className="pt-map-status pt-map-status-error" role="alert">
          <p>{strings.mapFailed}</p>
          <Link href={listHref} className="pt-btn">{strings.viewList}</Link>
        </div>
      ) : null}
    </div>
  );
}
