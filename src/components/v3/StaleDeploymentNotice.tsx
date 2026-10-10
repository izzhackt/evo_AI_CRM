"use client";

import { useCallback } from "react";

import { reloadForNewDeployment } from "@/lib/stale-deployment";
import { useStaleDeployment, useStaleDeploymentNotice } from "@/lib/use-stale-deployment";

export const STALE_DEPLOYMENT_TEXT = "Вышла новая версия — обновите страницу";

/**
 * Вкладка пережила выпуск (A1): строка у нижнего края окна в верхнем слое,
 * тем же видом, что «Отменить» (`.v3-toast`). Не красная — это не сбой, и
 * фокус не забирает. Живая область стоит всегда и объявляет новую версию
 * один раз; сама строка — только пока своё место не показывает подсказку.
 */
export function StaleDeploymentNotice() {
  const stale = useStaleDeployment();
  const visible = useStaleDeploymentNotice();
  const toastRef = useCallback((element: HTMLElement | null) => {
    if (!element || typeof element.showPopover !== "function" || element.matches(":popover-open")) return;
    element.showPopover();
  }, []);
  return (
    <>
      <p role="status" className="sr-only">{stale ? `${STALE_DEPLOYMENT_TEXT}.` : ""}</p>
      {visible ? (
        <div ref={toastRef} popover="manual" className="v3-toasts" data-testid="v3-stale-deployment">
          <div className="v3-toast">
            <p className="min-w-0 flex-1 break-words t-body-compact">{STALE_DEPLOYMENT_TEXT}</p>
            <button type="button" onClick={reloadForNewDeployment} className="v3-toast-action t-label">
              Обновить страницу
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
