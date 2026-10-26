"use client";

import { useId, useRef, useState } from "react";
import type { ApplicationDocumentItemTarget, ApplicationDocumentSelection } from "@/lib/portal/application-documents";
import { readApplicationDocumentReusableVersionsAction } from "@/lib/portal/application-documents-actions";
import { applicationDocumentNoticeVisible, type ApplicationDocumentNotice } from "@/lib/portal/application-documents-one-tap";
import {
  ProgramDocumentSubmit, ProgramDocumentUpload, useProgramDocumentPending,
  type ProgramDocumentItem as Item, type ProgramDocumentScope, type ProgramDocumentSendAfterSave,
} from "./ProgramDocumentControls";
import { ProgramFileEvidence, ProgramSubmissionEvidence, type ProgramDocumentStrings } from "./ProgramDocumentEvidence";
import { ProgramDocumentHistory, ProgramHistoryEvidence } from "./ProgramDocumentHistory";
import { ProgramDocumentReview } from "./ProgramDocumentReview";
import styles from "./ProgramDocuments.module.css";

type ItemProps = {
  item: Item; target: ApplicationDocumentItemTarget; scope: ProgramDocumentScope;
  audience: "student" | "staff"; strings: ProgramDocumentStrings; canReview?: boolean; onSaved: () => void;
  historyEpoch?: number;
};

export function ProgramDocumentItem(props: ItemProps) {
  // A new server snapshot invalidates locally paginated choices. Pending writes
  // live outside this component and retain their original immutable intent.
  const key = JSON.stringify([props.target, props.item.savedDraft, props.item.submission, props.item.reusableVersions, props.item.previousEvidence]);
  // «Sent» and «saved, not sent» must survive the remount that the refresh after the save causes.
  const [notice, setNotice] = useState<ApplicationDocumentNotice | null>(null);
  // A running one-tap send, kept here so a remount during it cannot show its own intent as an unfinished one.
  const [oneTapRun, setOneTapRun] = useState<ProgramDocumentSendAfterSave | null>(null);
  return <ProgramDocumentItemSnapshot key={key} {...props} notice={notice} onNotice={setNotice} oneTapRun={oneTapRun} onOneTapRun={setOneTapRun} />;
}

function ProgramDocumentItemSnapshot({ item, target, scope, audience, strings, canReview = false, onSaved, historyEpoch = 0, notice, onNotice, oneTapRun, onOneTapRun }: ItemProps & {
  notice: ApplicationDocumentNotice | null; onNotice: (notice: ApplicationDocumentNotice | null) => void;
  oneTapRun: ProgramDocumentSendAfterSave | null; onOneTapRun: (run: ProgramDocumentSendAfterSave | null) => void;
}) {
  const id = useId();
  const [versions, setVersions] = useState(item.reusableVersions);
  const [cursor, setCursor] = useState(item.reusableVersionsNextCursor);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const lock = useRef(false);
  const draft = item.savedDraft;
  const unsubmittedDraft = draft && draft.file.documentVersionId !== item.submission?.file.documentVersionId;
  const selectableVersions = versions.filter(version => version.file.documentVersionId !== item.submission?.file.documentVersionId);
  const chosen = selected ? selectableVersions.find(version => version.file.documentVersionId === selected) ?? null : null;
  const selection: ApplicationDocumentSelection | null = chosen ? chosen.selection
    : unsubmittedDraft ? { kind: "program_upload", uploadContextId: draft.uploadContextId, documentVersionId: draft.file.documentVersionId } : null;
  const selectionAvailable = (chosen?.file ?? (unsubmittedDraft ? draft.file : null))?.technicalAvailability === "available";
  // Student who may submit: saving the file also sends it. An unfinished earlier send is finished by its own button first.
  const submitPending = useProgramDocumentPending(scope, "submit", target.requirementItemId);
  // While a one-tap send runs, the intent it stored is its own: the item keeps the view it had at the tap.
  const sendAfterSave = oneTapRun ?? (audience === "student" && item.canSubmit && !submitPending.intent && !submitPending.blocked
    ? { previousSubmissionId: item.submission?.submissionId ?? null } : undefined);
  const noticeShown = notice !== null && applicationDocumentNoticeVisible(notice, {
    submittedVersionId: item.submission?.file.documentVersionId ?? null, reviewed: Boolean(item.submission?.review),
    unsentDraftVersionId: unsubmittedDraft ? draft.file.documentVersionId : null,
  });
  async function moreVersions() {
    if (lock.current || !cursor) return;
    lock.current = true; setLoading(true); setFailed(false);
    try {
      const result = await readApplicationDocumentReusableVersionsAction(scope, {
        studentCaseId: target.studentCaseId, applicationId: target.applicationId, requirementItemId: target.requirementItemId,
      }, cursor);
      if (!result.ok) { setFailed(true); return; }
      setVersions(current => [...current, ...result.page.versions.filter(value => !current.some(previous => previous.file.documentVersionId === value.file.documentVersionId))]);
      setCursor(result.page.nextCursor);
    } catch { setFailed(true); }
    finally { lock.current = false; setLoading(false); }
  }
  return <div className={`${styles.root} ${audience === "student" ? styles.portal : ""}`}>
    {unsubmittedDraft ? <section className={styles.section}>
      <h4 className={styles.heading}>{strings.savedOnly}</h4>
      <ProgramFileEvidence file={draft.file} target={target} audience={audience} strings={strings} />
      {item.submission ? <p className={styles.note}>{strings.newDraftHint}</p> : null}
    </section> : !item.submission ? <p className={styles.note}>{strings.noFile}</p> : null}

    {item.canUpload ? <details className={styles.details} open={!draft && !item.submission ? true : undefined}>
      <summary className={styles.summary}>{item.submission?.review && item.submission.review.decision !== "approved" ? strings.correctFile : draft || item.submission ? strings.replaceFile : strings.chooseFile}</summary>
      <p className={styles.note}>{sendAfterSave ? strings.saveHintOneTap : strings.saveHint}</p>
      <ProgramDocumentUpload scope={scope} target={target} audience={audience} strings={strings} onSaved={onSaved}
        sendAfterSave={sendAfterSave} onNotice={onNotice} onSendingChange={onOneTapRun} quiet={selection !== null} />
    </details> : <ProgramDocumentUpload scope={scope} target={target} audience={audience} strings={strings} onSaved={onSaved}
      sendAfterSave={sendAfterSave} onNotice={onNotice} onSendingChange={onOneTapRun} quiet={selection !== null} disabled />}

    {selectableVersions.length || cursor ? <details className={styles.details}>
      <summary className={styles.summary}>{strings.otherFile}</summary>
      <label className={styles.label} htmlFor={`${id}-version`}>{strings.chooseVersion}</label>
      <select id={`${id}-version`} className={styles.input} value={selected ?? ""} onChange={event => setSelected(event.target.value || null)}>
        <option value="">{strings.chooseVersion}</option>
        {selectableVersions.map(version => <option key={version.file.documentVersionId} value={version.file.documentVersionId}
          disabled={version.file.technicalAvailability !== "available"}>
          {version.file.originalFilename} · {version.file.versionNo}
        </option>)}
      </select>
      {chosen ? <div className={styles.section}><ProgramFileEvidence file={chosen.file} target={target} audience={audience} strings={strings} /></div> : null}
      {cursor ? <button type="button" className={styles.secondary} disabled={loading} onClick={() => void moreVersions()}>{loading ? strings.loading : strings.historyMore}</button> : null}
      {failed ? <p className={styles.error} role="alert">{strings.historyUnavailable}</p> : null}
    </details> : null}

    {noticeShown ? <p className={notice.tone === "success" ? styles.note : styles.error} role={notice.tone === "success" ? "status" : "alert"}>{notice.text}</p> : null}
    <ProgramDocumentSubmit scope={scope} target={target} audience={audience} strings={strings} selection={selection}
      previousSubmissionId={item.submission?.submissionId ?? null} disabled={!item.canSubmit || !selectionAvailable} onSaved={onSaved}
      hideWhenIdle={audience === "student"} suppressed={oneTapRun !== null} onAttempt={() => onNotice(null)} />
    {item.submission ? <>
      <ProgramSubmissionEvidence submission={item.submission} target={target} audience={audience} strings={strings} />
      {audience === "staff" ? <ProgramDocumentReview scope={scope} submission={item.submission} strings={strings} canReview={canReview} onSaved={onSaved} /> : null}
    </> : null}
    {item.previousEvidence ? <details className={styles.details}>
      <summary className={styles.summary}>{strings.previous}</summary>
      <p className={styles.note}>{strings.previousHint}</p>
      <ProgramHistoryEvidence entry={item.previousEvidence} target={{ studentCaseId: target.studentCaseId, applicationId: target.applicationId }} scope={scope}
        audience={audience} strings={strings} canReview={canReview} onSaved={onSaved} />
    </details> : null}
    <ProgramDocumentHistory key={historyEpoch} scope={scope} target={{ studentCaseId: target.studentCaseId, applicationId: target.applicationId }} requirementItemId={item.requirementItemId}
      audience={audience} strings={strings} canReview={canReview} onSaved={onSaved} />
  </div>;
}
