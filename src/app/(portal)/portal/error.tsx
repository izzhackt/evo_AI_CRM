"use client";

import { useEffect } from "react";

import { useBoundaryStrings } from "@/components/portal/useBoundaryLocale";
import { isStaleDeploymentError, markStaleDeployment, reloadForNewDeployment } from "@/lib/stale-deployment";
import { useInlineStalePrompt } from "@/lib/use-stale-deployment";

/**
 * Вкладка пережила выпуск (action прошлой сборки сервер не знает): `reset()`
 * повторил бы тот же мёртвый запрос, поэтому кнопка перезагружает страницу,
 * опросы оболочки останавливаются, а её карточка молчит — подсказка здесь.
 */
export default function StudentPortalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useBoundaryStrings();
  const stale = isStaleDeploymentError(error);
  useEffect(() => { if (stale) markStaleDeployment(); }, [stale]);
  useInlineStalePrompt(stale);
  return (
    <main className="pt-boundary mx-auto w-full max-w-[760px] px-4 py-12 sm:px-6 sm:py-16">
      <section role="alert" className="pt-card p-5">
        <p className="pt-boundary-muted text-xs font-semibold uppercase tracking-[0.1em]">
          {stale ? t.portalStaleKicker : t.portalErrorKicker}
        </p>
        <h1 className="mt-2 text-xl font-semibold">
          {stale ? t.portalStaleTitle : t.portalErrorTitle}
        </h1>
        <p className="pt-boundary-muted mt-2 text-sm leading-6">
          {stale ? t.portalStaleText : t.portalErrorText}
        </p>
        <button
          type="button"
          onClick={stale ? reloadForNewDeployment : reset}
          className="pt-btn mt-5 text-sm"
        >
          {stale ? t.portalStaleAction : t.portalErrorAction}
        </button>
      </section>
    </main>
  );
}
