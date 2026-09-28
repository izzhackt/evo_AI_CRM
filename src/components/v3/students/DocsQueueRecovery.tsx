"use client";

import { useRouter } from "next/navigation";
import { useMemo, useSyncExternalStore } from "react";

import { ProgramDocumentRecovery } from "@/components/portal/admissionPreparations/ProgramDocumentRecovery";
import styles from "@/components/portal/admissionPreparations/ProgramDocuments.module.css";
import { PackageQueueRecovery } from "@/components/portal/applicationPackages/PackageRecovery";
import { packageStrings } from "@/components/portal/applicationPackages/strings";
import type { ApplicationDocumentOwner, ApplicationDocumentScope } from "@/lib/portal/application-documents";
import { APPLICATION_DOCUMENT_PENDING_EVENT, listApplicationDocumentPendingScopes } from "@/lib/portal/application-documents-pending";
import { getPortalStrings } from "@/lib/portal/i18n";

function subscribePending(callback: () => void) {
  window.addEventListener(APPLICATION_DOCUMENT_PENDING_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(APPLICATION_DOCUMENT_PENDING_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

/**
 * Незавершённые решения по документам программ этой учётной записи (все дела
 * и программы, сохранённые в браузере до ответа сервера) — то восстановление,
 * что было у очереди на подстранице доски поступления. Решения по видимым
 * строкам повторяет сама строка; здесь — остальные. Подтверждённый ответ
 * перечитывает вкладку.
 */
export function ProgramDocsRecovery({ owner, visibleSubmissions }: Readonly<{
  owner: ApplicationDocumentOwner;
  visibleSubmissions: readonly string[];
}>) {
  const router = useRouter();
  const strings = getPortalStrings("programDocuments", "ru");
  const snapshot = useSyncExternalStore(subscribePending, () => {
    try { return JSON.stringify(listApplicationDocumentPendingScopes(owner, "review")); } catch { return "unavailable"; }
  }, () => "[]");
  const scopes = useMemo(() => snapshot === "unavailable" ? [] : JSON.parse(snapshot) as readonly ApplicationDocumentScope[], [snapshot]);
  if (snapshot === "unavailable") return <p className="t-body-compact text-danger" role="alert">{strings.storageUnavailable}</p>;
  if (scopes.length === 0) return null;
  // Повтор решения — подтверждение: тёмный нейтральный (`[data-docs-neutral]` в v3.css), не сплошной красный.
  return <div data-docs-neutral="">{scopes.map((scope) => <ProgramDocumentRecovery key={`${scope.studentCaseId}:${scope.applicationId}`} scope={scope} audience="staff"
    currentItemIds={[]} currentSubmissionIds={visibleSubmissions} onlyReviews strings={strings} onSaved={() => router.refresh()} />)}</div>;
}

/**
 * Незавершённые решения по комплектам этой учётной записи — восстановление
 * очереди комплектов подстраницы доски поступления. «Повторить сохранённое
 * действие» — подтверждение: тёмная нейтральная кнопка (`[data-docs-neutral]`
 * в v3.css). Подтверждённый ответ перечитывает вкладку.
 */
export function PackagesRecovery({ owner }: Readonly<{ owner: ApplicationDocumentOwner }>) {
  const router = useRouter();
  return <div data-docs-neutral="" className={`${styles.root} t-body-compact`}><PackageQueueRecovery owner={owner} strings={packageStrings("ru")} onSaved={() => router.refresh()} /></div>;
}
