import { randomUUID } from "node:crypto";

import { staffHasPermission } from "@/lib/platform-access";
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
import type { DocumentStateFilter } from "./documents-view";
import { documentsView } from "./DocumentsView";

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
  filter = "all",
  tabHref,
}: Readonly<{
  groups: readonly DocumentGroup[];
  uploadAccess: DocumentUploadAccess;
  studentCaseId: string | null;
  actor: ActivePlatformActor;
  recognition?: DocumentRecognitionAccess | null;
  filter?: DocumentStateFilter;
  tabHref: string;
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

  return documentsView({
    groups,
    uploadAccess,
    studentCaseId,
    recognition,
    filter,
    tabHref,
    today: dayInOrganizationTimezone(new Date()),
    createRequestId,
    baselineOptions,
    baselineOptionsUnavailable,
    baselineTemplatesAbsent,
    baselineChecklistRequestId,
  });
}
