"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { DetailSheet, KeyFacts, StatusBadge } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { ProgramFileEvidence } from "@/components/portal/admissionPreparations/ProgramDocumentEvidence";
import { ProgramDocumentReview } from "@/components/portal/admissionPreparations/ProgramDocumentReview";
import styles from "@/components/portal/admissionPreparations/ProgramDocuments.module.css";
import type { ApplicationDocumentOwner, ApplicationDocumentQueueItem } from "@/lib/portal/application-documents";
import { getPortalStrings } from "@/lib/portal/i18n";

import { sheetEscape } from "../panel/sheet-escape";
import { docsWaiting, studentsCaseHref } from "../students/students-queue-view";
import { WaitingWord } from "./DocsCells";
import { deadlineText, programOf } from "./docs-program-model";

const EVIDENCE = `${styles.root} t-body-compact`;

/**
 * Документ программы на проверке в панели: файл со «Скачать файл» и решение — те же `ProgramFileEvidence` и
 * `ProgramDocumentReview`, что были в строке очереди (незавершённое решение хранит браузер, повтор — тот же запрос).
 * «Сохранить решение» — тёмная нейтральная кнопка (`data-docs-neutral`): красная на странице одна.
 */
export function ProgramDocSheet({ item, owner, canReview, today, returnTo, open, onOpenChange }: Readonly<{
  item: ApplicationDocumentQueueItem;
  owner: ApplicationDocumentOwner;
  canReview: boolean;
  today: string;
  returnTo: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}>) {
  const router = useRouter();
  const strings = getPortalStrings("programDocuments", "ru");
  const scope = { ...owner, studentCaseId: item.studentCaseId, applicationId: item.applicationId };
  const target = {
    studentCaseId: item.studentCaseId, applicationId: item.applicationId, requirementsRevisionId: item.submission.requirementsRevisionId,
    requirementItemId: item.submission.requirementItemId, documentSlotId: item.submission.documentSlotId,
  };
  const waiting = docsWaiting(item.submission.submittedAt, today);
  const deadline = item.deadline ? deadlineText(item.deadline, today) : null;
  const href = `${studentsCaseHref(item.studentCaseId, { docs: true, tab: "route", returnTo })}#preparation-${item.applicationId}`;
  return (
    <DetailSheet open={open} onOpenChange={onOpenChange} onEscapeKeyDown={sheetEscape} title={`${item.studentDisplayName} · ${item.requirementLabel}`} description={programOf(item)}
      footer={<Button variant="outline" asChild><Link href={href}>{strings.openProgram}</Link></Button>}>
      <div className="space-y-4" data-testid="v3-program-document-sheet">
        {!item.isCurrentRequirement ? <StatusBadge label={strings.olderRequirement} tone="warn" /> : null}
        <KeyFacts columns={2} facts={[
          { label: "Отправлен", value: waiting ? <><time dateTime={waiting.dateTime} className="font-mono tabular-nums">{waiting.day}</time> · <WaitingWord waiting={waiting} /></> : null },
          { label: "Срок требования", value: deadline ? <span title={deadline.full} className="whitespace-nowrap">{deadline.short}</span> : null },
        ]} />
        <div className={EVIDENCE}><ProgramFileEvidence file={item.submission.file} target={target} audience="staff" strings={strings} /></div>
        <div data-docs-neutral="" className={EVIDENCE}>
          <ProgramDocumentReview scope={scope} submission={item.submission} strings={strings} canReview={canReview} onSaved={() => router.refresh()} />
        </div>
      </div>
    </DetailSheet>
  );
}
