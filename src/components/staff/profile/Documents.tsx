import { randomUUID } from "node:crypto";

import { isStaffPreview, staffHasPermission } from "@/lib/platform-access";
import { readCaseDocumentSuggestions } from "@/lib/v3/document-suggestions-source";
import type { ActivePlatformActor } from "@/lib/platform-auth";
import {
  listCaseBaselineChecklistOptions,
  type PlatformCaseBaselineChecklistOption,
} from "@/lib/platform-private-documents";
import { dayInOrganizationTimezone } from "@/lib/platform-task-deadline";

import type {
  ActiveDocumentGroup,
  BaselineChecklistOption,
  DocumentGroup,
  DocumentUploadAccess,
  DocumentRecognitionAccess,
} from "./document-types";
import { documentsView } from "./DocumentsView";
import { AmoDocumentSorting } from "./AmoDocumentSorting";
import { canSortDocuments } from "./amo-sorting-access";
import { amoSortingFiles, sortingMode, sortingRows } from "./amo-sorting-view";

function baselineChecklistOptionLabel(
  option: PlatformCaseBaselineChecklistOption,
): string {
  const route = [option.targetCountry, option.targetDegree, option.programDirection]
    .filter((part): part is string => part !== null)
    .join(" · ");
  return `${route} · версия ${option.checklistVersion} — ${option.requirementCount} документов`;
}

/**
 * Server-backed projection of the canonical checklist and current private file.
 * The client child only reports success after the canonical route confirms the
 * Supabase Storage write; refreshing the route remains the read authority.
 * The tab itself is the synchronous `documentsView` (Э8.1): this wrapper only
 * reads the baseline options and issues the command ids.
 */
export async function Documents({
  groups,
  uploadAccess,
  studentCaseId,
  actor,
  recognition = null,
  nextUi = false,
}: Readonly<{
  groups: readonly DocumentGroup[];
  uploadAccess: DocumentUploadAccess;
  studentCaseId: string | null;
  actor: ActivePlatformActor;
  recognition?: DocumentRecognitionAccess | null;
  /** «Новый вид»: те же чтения и права, другая раскладка. */
  nextUi?: boolean;
}>) {
  const activeGroups = groups.filter(
    (group): group is ActiveDocumentGroup => group.kind === "active",
  );
  const createRequestId = uploadAccess === "allowed" && studentCaseId
    ? randomUUID()
    : null;

  let baselineOptions: readonly BaselineChecklistOption[] = [];
  let baselineOptionsUnavailable = false;
  let baselineOptionsRead = false;
  // The read itself requires document.manage; without it the server always
  // refuses, so it is not attempted (the apply form stays hidden, as before).
  if (
    uploadAccess === "allowed"
    && studentCaseId
    && staffHasPermission(actor, "document.manage")
  ) {
    try {
      const rows = await listCaseBaselineChecklistOptions(actor, studentCaseId);
      baselineOptions = Object.freeze(rows.map((row) => Object.freeze({
        countryRequirementVersionId: row.countryRequirementVersionId,
        label: baselineChecklistOptionLabel(row),
      })));
      baselineOptionsRead = true;
    } catch {
      // A failed read is not "no templates": keep the form hidden, say so.
      baselineOptions = [];
      baselineOptionsUnavailable = true;
    }
  }
  // «No templates» only from a successful read that returned nothing, and only
  // while the case has no template-backed item: once a baseline was applied
  // the list is empty by design (the binding is one-time, 179), not absent.
  const baselineTemplatesAbsent = baselineOptionsRead
    && baselineOptions.length === 0
    && !activeGroups.some((group) => group.items.some((item) => item.intentKind === "baseline"));
  const baselineChecklistRequestId =
    uploadAccess === "allowed" && studentCaseId && baselineOptions.length > 0
      ? randomUUID()
      : null;

  // Файлы из amoCRM без разбора (миграция 333): подсказки читает база с учётом согласия студента; без чтения - ручной выбор.
  const sortingFiles = amoSortingFiles(activeGroups);
  let sorting = null;
  if (sortingFiles.length > 0 && studentCaseId) {
    const suggestions = isStaffPreview(actor) ? null : await readCaseDocumentSuggestions(actor, studentCaseId);
    sorting = (
      <AmoDocumentSorting
        key={studentCaseId}
        studentCaseId={studentCaseId}
        rows={sortingRows(sortingFiles, suggestions)}
        mode={sortingMode(suggestions)}
        canAct={canSortDocuments(actor, uploadAccess === "allowed")}
      />
    );
  }

  return documentsView({
    sorting,
    groups,
    uploadAccess,
    studentCaseId,
    recognition,
    today: dayInOrganizationTimezone(new Date()),
    createRequestId,
    baselineOptions,
    baselineOptionsUnavailable,
    baselineTemplatesAbsent,
    baselineChecklistRequestId,
    nextUi,
  });
}
