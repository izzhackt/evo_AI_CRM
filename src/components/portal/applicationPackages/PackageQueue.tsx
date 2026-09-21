"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import type { ApplicationDocumentOwner } from "@/lib/portal/application-documents";
import type { ApplicationPackageQueue } from "@/lib/portal/application-packages";
import { readStaffApplicationPackageQueueAction } from "@/lib/portal/application-packages-actions";
import { getPortalStrings } from "@/lib/portal/i18n";
import { ProgramDocumentTime } from "../admissionPreparations/ProgramDocumentEvidence";
import { PackageQueueRecovery } from "./PackageRecovery";
import { PackageDetailLoader, packageStatus } from "./PackageDetail";
import { packageStrings } from "./strings";
import s from "../admissionPreparations/ProgramDocuments.module.css";
type QueueProps = { owner: ApplicationDocumentOwner; initial: ApplicationPackageQueue | null; canReview: boolean };
export function PackageQueue(props: QueueProps) { return <QueueState key={`${props.owner.organizationId}:${props.owner.membershipId}`} {...props} />; }
function QueueState({ owner, initial, canReview }: QueueProps) {
  const t = packageStrings("ru"), documentStrings = getPortalStrings("programDocuments", "ru");
  const [rows, setRows] = useState(initial?.items ?? []), [cursor, setCursor] = useState(initial?.nextCursor ?? null);
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(initial === null), [opened, setOpened] = useState<string | null>(null), [epoch, setEpoch] = useState(0);
  const lock = useRef(false);
  const [notice, setNotice] = useState<string | null>(null);
  const saved = (message?: string) => { if (message) setNotice(message); void load(false); };
  async function load(more: boolean) {
    if (lock.current || (more && !cursor)) return; lock.current = true; setBusy(true); setFailed(false); if (!more) setEpoch(value => value + 1);
    try { const result = await readStaffApplicationPackageQueueAction(owner, more ? cursor : null);
      if (!result.ok) { setFailed(true); return; }
      setRows(old => more ? [...old, ...result.queue.items.filter(row => !old.some(value => value.package.packageId === row.package.packageId))] : result.queue.items); setCursor(result.queue.nextCursor);
    } catch { setFailed(true); } finally { lock.current = false; setBusy(false); }
  }
  return <section className={s.root} aria-label={t.queue} aria-busy={busy}>
    <PackageQueueRecovery owner={owner} strings={t} onSaved={saved} />
    {notice ? <p role="status" className={s.note}>{notice}</p> : null}
    {failed ? <p className={s.error} role="alert">{t.unavailable}</p> : null}
    {!failed && !busy && !rows.length ? <p className={s.note}>{t.queueEmpty}</p> : null}
    <ol className={s.list}>{rows.map(row => {
      const scope = { ...owner, studentCaseId: row.studentCaseId, applicationId: row.applicationId };
      return <li key={row.package.packageId}><h2 className={s.heading}>{row.studentDisplayName} · {row.program.programTitle}</h2><p className={s.note}>{row.program.universityTitle} · {row.program.intakeLabel}</p>
        <p className={s.meta}>{packageStatus(row.package, t)} · <ProgramDocumentTime value={row.package.submittedAt} /></p>{!row.package.isCurrentRequirements ? <p className={s.note}>{t.older}</p> : null}
        <div className={s.actions}><button type="button" className={s.secondary} aria-expanded={opened === row.package.packageId} onClick={() => setOpened(old => old === row.package.packageId ? null : row.package.packageId)}>{t.open}</button><Link className={s.link} href={`/v3/profile?case=${row.studentCaseId}&tab=route#preparation-${row.applicationId}`}>{t.openProgram}</Link></div>
        {opened === row.package.packageId ? <PackageDetailLoader scope={scope} packageId={row.package.packageId} audience="staff" strings={t} documentStrings={documentStrings} canReview={canReview} epoch={epoch} onSaved={saved} /> : null}
      </li>;
    })}</ol>
    <div className={s.actions}><button type="button" className={s.secondary} disabled={busy} onClick={() => void load(false)}>{busy ? t.loading : t.refresh}</button>{cursor ? <button type="button" className={s.secondary} disabled={busy} onClick={() => void load(true)}>{t.more}</button> : null}</div>
  </section>;
}
