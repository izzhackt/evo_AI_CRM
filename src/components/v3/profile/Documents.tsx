import { randomUUID } from "node:crypto";

import { Pill } from "@/components/v3/Pill";
import type { ActivePlatformActor } from "@/lib/platform-auth";
import {
  listCaseBaselineChecklistOptions,
  type PlatformCaseBaselineChecklistOption,
} from "@/lib/platform-private-documents";

import { Card } from "@/components/ui";
import type {
  ActiveDocumentGroup,
  BaselineChecklistOption,
  DocumentGroup,
  DocumentUploadAccess,
  DocumentRecognitionAccess,
  RemovedDocumentGroup,
} from "./document-types";
import { ProfileDocumentsClient } from "./ProfileDocumentsClient";

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
 */
export async function Documents({
  groups,
  uploadAccess,
  studentCaseId,
  actor,
  recognition = null,
}: Readonly<{
  groups: readonly DocumentGroup[];
  uploadAccess: DocumentUploadAccess;
  studentCaseId: string | null;
  actor: ActivePlatformActor;
  recognition?: DocumentRecognitionAccess | null;
}>) {
  const activeGroups = groups.filter(
    (group): group is ActiveDocumentGroup => group.kind === "active",
  );
  const historyGroups = groups.filter(
    (group): group is RemovedDocumentGroup => group.kind === "removed",
  );
  const total = activeGroups.reduce((count, group) => count + group.items.length, 0);
  const present = activeGroups.reduce(
    (count, group) => count + group.items.filter((item) => item.presence === "present").length,
    0,
  );
  const createRequestId = uploadAccess === "allowed" && studentCaseId
    ? randomUUID()
    : null;

  let baselineOptions: readonly BaselineChecklistOption[] = [];
  if (uploadAccess === "allowed" && studentCaseId) {
    try {
      const rows = await listCaseBaselineChecklistOptions(actor, studentCaseId);
      baselineOptions = Object.freeze(rows.map((row) => Object.freeze({
        countryRequirementVersionId: row.countryRequirementVersionId,
        label: baselineChecklistOptionLabel(row),
      })));
    } catch {
      baselineOptions = [];
    }
  }
  const baselineChecklistRequestId =
    uploadAccess === "allowed" && studentCaseId && baselineOptions.length > 0
      ? randomUUID()
      : null;

  return (
    <div className="flex flex-col gap-4">
      <Card eyebrow title="Чеклист" aside={<Pill>{present}/{total}</Pill>}>
        <ProfileDocumentsClient
          groups={activeGroups}
          historyGroups={historyGroups}
          uploadAccess={uploadAccess}
          studentCaseId={studentCaseId}
          createRequestId={createRequestId}
          baselineOptions={baselineOptions}
          baselineChecklistRequestId={baselineChecklistRequestId}
          recognition={recognition}
        />
      </Card>
    </div>
  );
}
