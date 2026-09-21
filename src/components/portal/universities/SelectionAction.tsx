"use client";

import Link from "next/link";
import { useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import type { CatalogPreparationFailure, CatalogPreparationIntent } from "@/lib/portal/catalog-preparations";
import type { PortalStrings } from "@/lib/portal/i18n";
import {
  clearPreparationIntent, persistPreparationIntent, readPendingRequirements, readPendingSelection,
  selectionTarget, type StudentPreparationScope,
} from "@/lib/portal/student-preparation-pending";
import {
  initializeStudentPreparationUIAction, readStudentPreparationUIAction, selectStudentPreparationUIAction,
} from "@/lib/portal/student-preparation-ui-actions";

export type StudentSelectionContext = Readonly<{
  scope: StudentPreparationScope;
  canSelect: boolean;
  bindings: readonly Readonly<{ applicationId: string; institutionId: string; programId: string; intakeId: string }>[] | null;
  strings: PortalStrings<"preparations">;
}>;

function selectionError(reason: CatalogPreparationFailure, strings: PortalStrings<"preparations">): string {
  switch (reason) {
    case "unavailable": return strings.unavailable;
    case "stale_publication": return strings.stalePublication;
    case "forbidden": return strings.forbidden;
    case "case_ineligible": return strings.caseIneligible;
    case "request_conflict": return strings.requestConflict;
    case "unsupported_country": return strings.unsupportedCountry;
    case "intake_identity_required": return strings.identityMissing;
    case "intake_closed": case "intake_expired": return strings.closedIntake;
    default: return strings.choiceUnavailable;
  }
}

function subscribePending(callback: () => void) {
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}

export function SelectionAction({ context, target, existingApplicationId, blocked, uncertainDeadline }: {
  context: StudentSelectionContext;
  target: Omit<CatalogPreparationIntent, "requestId"> | null;
  existingApplicationId: string | null;
  blocked: "closedIntake" | "identityMissing" | "unsupportedCountry" | null;
  uncertainDeadline: boolean;
}) {
  const { scope, strings } = context;
  const router = useRouter();
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [terminal, setTerminal] = useState(false);
  const targetKey = target ? selectionTarget(target) : null;
  const stored = useSyncExternalStore(subscribePending, () => {
    // Recovery reads local state only; no command runs during render or mount.
    if (!targetKey) return "none";
    try { return readPendingSelection(scope, targetKey) ? "pending" : "none"; }
    catch { return "unavailable"; }
  }, () => "none");
  const visibleError = error ?? (stored === "unavailable" ? strings.storageUnavailable : null);

  async function select() {
    if (lock.current || !target || !targetKey) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    let applicationId: string | null = null;
    try {
      let intent: CatalogPreparationIntent;
      try {
        intent = readPendingSelection(scope, targetKey) ?? { ...target, requestId: crypto.randomUUID() };
        persistPreparationIntent(scope, intent);
      } catch {
        setError(strings.storageUnavailable);
        return;
      }
      setPending(true);
      const result = await selectStudentPreparationUIAction(scope, intent);
      if (!result.ok) {
        if (result.reason !== "unavailable") {
          try { clearPreparationIntent(scope, intent); } catch { /* confirmed response stays confirmed */ }
          setPending(false);
          setTerminal(true);
        }
        setError(selectionError(result.reason, strings));
        return;
      }
      applicationId = result.applicationId;
      try { clearPreparationIntent(scope, intent); } catch { /* the saved binding is authoritative */ }
      // Selection and initialization are separate operations. A failure below
      // must never repeat selection or hide its already saved application.
      const current = await readStudentPreparationUIAction(scope, applicationId);
      if (current.ok && current.requirements.state === "uninitialized" && current.canInitialize) {
        const initialization = readPendingRequirements(scope, applicationId) ?? {
          studentCaseId: scope.studentCaseId, applicationId, requestId: crypto.randomUUID(),
        };
        persistPreparationIntent(scope, initialization);
        const initialized = await initializeStudentPreparationUIAction(scope, initialization);
        if (initialized.ok || initialized.reason !== "unavailable") {
          try { clearPreparationIntent(scope, initialization); } catch { /* known result */ }
        }
      }
    } catch {
      if (!applicationId) setError(strings.unavailable);
    } finally {
      if (applicationId) {
        router.push(`/portal/preparations/${applicationId}`);
        router.refresh();
      }
      lock.current = false;
      setBusy(false);
    }
  }

  if (existingApplicationId) return <div className="pt-prep-selection"><Link className="pt-btn" href={`/portal/preparations/${existingApplicationId}`}>{strings.open}</Link></div>;
  const unavailable = context.bindings === null ? strings.listUnavailable
    : !context.canSelect ? strings.caseIneligible : blocked ? strings[blocked] : null;
  return <div className="pt-prep-selection">
    {unavailable ? <p className="pt-prep-note">{unavailable}</p> : <>
      <p className="pt-prep-note">{strings.selectionHint}</p>
      {uncertainDeadline ? <p className="pt-prep-note">{strings.confirmDeadline}</p> : null}
      {!terminal ? <button type="button" className="pt-btn" disabled={busy} onClick={select}>
        {busy ? strings.selecting : pending || stored === "pending" ? strings.retrySelection : strings.select}
      </button> : null}
    </>}
    {visibleError ? <p className="pt-prep-error" role="alert">{visibleError}</p> : null}
    {terminal || context.bindings === null ? <button type="button" className="pt-btn-ghost" onClick={() => window.location.reload()}>{strings.refresh}</button> : null}
  </div>;
}
