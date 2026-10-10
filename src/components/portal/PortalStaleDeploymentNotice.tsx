"use client";

import type { PortalStrings } from "@/lib/portal/i18n";
import { reloadForNewDeployment } from "@/lib/stale-deployment";
import { useStaleDeployment, useStaleDeploymentNotice } from "@/lib/use-stale-deployment";

/**
 * Вкладка кабинета пережила выпуск (A1): опросы уже стоят, и тихая карточка
 * под верхней полосой — тем же видом, что сбой уведомлений, — просит обновить
 * страницу. Фокус не забирает; живая область объявляет один раз.
 */
export function PortalStaleDeploymentNotice({ strings }: { strings: PortalStrings<"shell"> }) {
  const stale = useStaleDeployment();
  const visible = useStaleDeploymentNotice();
  return (
    <>
      <p role="status" className="pt-sr-only">{stale ? strings.staleVersion : ""}</p>
      {visible ? (
        <div className="pt-stale-version" data-testid="portal-stale-deployment">
          <p>{strings.staleVersion}</p>
          <button type="button" className="pt-link" onClick={reloadForNewDeployment}>{strings.staleVersionReload}</button>
        </div>
      ) : null}
    </>
  );
}
