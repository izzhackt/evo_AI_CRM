"use client";

import Link from "next/link";
import { useEffect } from "react";

import { useBoundaryStrings } from "@/components/portal/useBoundaryLocale";
import { isStaleDeploymentError, markStaleDeployment, reloadForNewDeployment } from "@/lib/stale-deployment";
import { useInlineStalePrompt } from "@/lib/use-stale-deployment";

/**
 * Границы ошибок рендерятся без серверного locale-прохода, поэтому язык берётся
 * из `<html lang>` (useBoundaryStrings). Вкладка на прошлой сборке получает
 * перезагрузку вместо повтора (см. portal/error.tsx).
 */
export default function TestsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useBoundaryStrings();
  const stale = isStaleDeploymentError(error);
  useEffect(() => { if (stale) markStaleDeployment(); }, [stale]);
  useInlineStalePrompt(stale);
  return (
    <main className="pt-page">
      <section role="alert" className="pt-run-card">
        <h1 className="pt-run-heading">{stale ? t.testsStaleTitle : t.testsErrorTitle}</h1>
        <p className="pt-run-text">
          {stale ? t.testsStaleLead : t.testsErrorLead}
          {t.testsSavedNote}
          {stale ? null : t.testsForeignNote}
        </p>
        <div className="pt-run-nav">
          <button type="button" className="pt-btn" onClick={stale ? reloadForNewDeployment : reset}>
            {stale ? t.testsStaleAction : t.testsErrorAction}
          </button>
          <Link className="pt-btn-ghost" href="/portal/tests">{t.testsBack}</Link>
        </div>
      </section>
    </main>
  );
}
