"use client";

import { useState } from "react";
import type { ApplicationDocumentItemTarget, ApplicationDocuments } from "@/lib/portal/application-documents";
import { downloadApplicationDocumentFile } from "@/lib/portal/application-documents-upload";
import { formatPortalString, type PortalStrings } from "@/lib/portal/i18n";
import styles from "./ProgramDocuments.module.css";

type Item = ApplicationDocuments["items"][number];
export type ProgramFile = NonNullable<Item["savedDraft"]>["file"];
export type ProgramSubmission = NonNullable<Item["submission"]>;
export type ProgramDocumentStrings = PortalStrings<"programDocuments">;

export function ProgramDocumentTime({ value }: { value: string }) {
  // Render consistently on server and client. The timestamp retains its exact instant.
  const label = new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bishkek",
  }).format(new Date(value));
  return <time className={styles.time} dateTime={value}>{label} (Бишкек)</time>;
}

export function ProgramFileEvidence({ file, target, audience, strings, disabled = false }: {
  file: ProgramFile;
  target: ApplicationDocumentItemTarget;
  audience: "student" | "staff";
  strings: ProgramDocumentStrings;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  async function download() {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const result = await downloadApplicationDocumentFile({ audience, target, documentVersionId: file.documentVersionId });
      setFailed(!result.ok);
    } catch { setFailed(true); }
    finally { setBusy(false); }
  }
  return <div>
    <p className={styles.filename}>{file.originalFilename}</p>
    <p className={styles.meta}>{formatPortalString(strings.version, { version: file.versionNo })}</p>
    <button type="button" className={styles.secondary} disabled={disabled || busy || file.technicalAvailability !== "available"} onClick={() => void download()}>
      {busy ? strings.downloading : strings.download}
    </button>
    {file.technicalAvailability !== "available" ? <ul className={styles.list}>{file.unavailableReasons.map(reason =>
      <li key={reason} className={styles.note}>{strings[`availability.${reason}` as keyof ProgramDocumentStrings] ?? strings.downloadFailed}</li>)}</ul> : null}
    {failed ? <p className={styles.error} role="alert">{strings.downloadFailed}</p> : null}
  </div>;
}

export function ProgramSubmissionEvidence({ submission, target, audience, strings }: {
  submission: ProgramSubmission;
  target: ApplicationDocumentItemTarget;
  audience: "student" | "staff";
  strings: ProgramDocumentStrings;
}) {
  return <section className={styles.section}>
    <h4 className={styles.heading}>{strings.submittedFile}</h4>
    <ProgramFileEvidence file={submission.file} target={{ ...target,
      requirementsRevisionId: submission.requirementsRevisionId,
      requirementItemId: submission.requirementItemId, documentSlotId: submission.documentSlotId,
    }} audience={audience} strings={strings} />
    <p className={styles.meta}>{strings.submittedAt}: <ProgramDocumentTime value={submission.submittedAt} /></p>
    <p className={styles.note}>{submission.review ? strings[`review.${submission.review.decision}`] : strings.waitingReview}</p>
    {submission.review?.reason ? <p className={styles.reason}>{submission.review.reason}</p> : null}
    {submission.review ? <p className={styles.meta}>{strings.reviewedAt}: <ProgramDocumentTime value={submission.review.reviewedAt} /></p> : null}
  </section>;
}
