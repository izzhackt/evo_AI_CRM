"use client";
import { useRef, useState } from "react";
import type { ApplicationPackageSummary } from "@/lib/portal/application-packages";
import type { ApplicationPackageScope } from "@/lib/portal/application-packages-pending";
import type { ApplicationDocumentCursor } from "@/lib/portal/application-documents";
import { readApplicationPackageHistoryAction } from "@/lib/portal/application-packages-actions";
import { ProgramDocumentTime, type ProgramDocumentStrings } from "../admissionPreparations/ProgramDocumentEvidence";
import { PackageDetailLoader, packageStatus } from "./PackageDetail";
import type { PackageAudience } from "./commands";
import type { PackageStrings } from "./strings";
import s from "../admissionPreparations/ProgramDocuments.module.css";
export function PackageHistory({ scope, audience, strings: t, documentStrings, canReview, onSaved }: { scope: ApplicationPackageScope; audience: PackageAudience; strings: PackageStrings; documentStrings: ProgramDocumentStrings; canReview?: boolean; onSaved: (message?: string) => void }) {
  const [rows, setRows] = useState<ApplicationPackageSummary[]>([]), [cursor, setCursor] = useState<ApplicationDocumentCursor | null>(null), [openId, setOpenId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false), [busy, setBusy] = useState(false), [failed, setFailed] = useState(false), [epoch, setEpoch] = useState(0);
  const lock = useRef(false);
  async function load(reset: boolean) {
    if (lock.current) return; lock.current = true; setBusy(true); setFailed(false);
    if (reset) setEpoch(value => value + 1);
    try { const result = await readApplicationPackageHistoryAction(scope, { studentCaseId: scope.studentCaseId, applicationId: scope.applicationId }, reset ? null : cursor);
      if (!result.ok) { setFailed(true); return; } setRows(old => reset ? [...result.history.packages] : [...old, ...result.history.packages.filter(row => !old.some(value => value.packageId === row.packageId))]); setCursor(result.history.nextCursor); setLoaded(true);
    } catch { setFailed(true); } finally { lock.current = false; setBusy(false); }
  }
  return <details className={s.details} id={`package-history-${scope.applicationId}`}><summary className={s.summary} onClick={() => { if (!loaded) void load(true); }}>{t.history}</summary>
    {busy ? <p role="status">{t.loading}</p> : null}{failed ? <p className={s.error} role="alert">{t.unavailable}</p> : null}{loaded && !rows.length ? <p className={s.note}>{t.noHistory}</p> : null}
    <ol className={s.list}>{rows.map(row => <li key={row.packageId}><p className={s.heading}>{t.version} {row.packageVersion} · {packageStatus(row, t)}</p><p className={s.meta}><ProgramDocumentTime value={row.submittedAt} /></p>
      <button type="button" className={s.secondary} aria-expanded={openId === row.packageId} onClick={() => setOpenId(openId === row.packageId ? null : row.packageId)}>{t.open}</button>
      {openId === row.packageId ? <PackageDetailLoader scope={scope} packageId={row.packageId} audience={audience} strings={t} documentStrings={documentStrings} canReview={canReview} epoch={epoch} onSaved={(message) => { void load(true); onSaved(message); }} /> : null}
    </li>)}</ol><div className={s.actions}><button type="button" className={s.secondary} disabled={busy} onClick={() => void load(true)}>{t.refresh}</button>{cursor ? <button type="button" className={s.secondary} disabled={busy} onClick={() => void load(false)}>{t.more}</button> : null}</div>
  </details>;
}
