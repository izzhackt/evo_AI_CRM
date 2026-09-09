import { PartShell } from "@/components/v3/PartShell";
import { Settings } from "@/components/v3/settings/Settings";
import { isSectionKey } from "@/components/v3/settings/types";
import { requireV3PageActor } from "@/lib/platform-guards";
import { redirect } from "next/navigation";

import { normalizeJournalFilters } from "@/lib/v3/settings-journal-contract";
import { readStaffWorkspace } from "@/lib/v3/staff-workspace-source";
import {
  readAuditExportEnabled,
  readCapabilityNames,
  readGateFacts,
  readHealth,
  readIntegrations,
  readJournal,
  readJournalFacets,
  readPlatformFact,
  readRoles,
  readRouteNames,
} from "@/lib/v3/settings-source";

export const dynamic = "force-dynamic";
export const metadata = { title: "V3 · Настройки" };

export default async function SettingsPart({
  searchParams,
}: {
  searchParams: Promise<{
    section?: string;
    object?: string;
    snapshot?: string;
    snapshotId?: string;
    cursor?: string;
    cursorId?: string;
  }>;
}) {
  const params = await searchParams;
  const section = isSectionKey(params.section) ? params.section : "state";
  const journalFilters = normalizeJournalFilters({
    objectType: params.object,
  });
  const actor = await requireV3PageActor("/v3/settings");
  const isAdmin = actor.presentationRole === "admin";

  const [health, integrations, journalRead, journalFacets, gates, platform, staff] = await Promise.all([
    readHealth(actor),
    readIntegrations(actor),
    isAdmin
      ? readJournal(actor, journalFilters, {
          snapshotCreatedAt: params.snapshot,
          snapshotId: params.snapshotId,
          cursorCreatedAt: params.cursor,
          cursorId: params.cursorId,
        })
      : Promise.resolve({ entries: [], cursorHonored: true }),
    isAdmin
      ? readJournalFacets(actor)
      : Promise.resolve({ objectTypes: [] }),
    readGateFacts(actor),
    readPlatformFact(),
    isAdmin && section === "staff" ? readStaffWorkspace(actor) : Promise.resolve(undefined),
  ]);

  // Протухший курсор из адреса читается первой страницей; адрес при этом
  // обязан перестать врать — курсор снимается редиректом.
  if (!journalRead.cursorHonored) {
    const clean = new URLSearchParams();
    clean.set("section", "journal");
    if (params.object) clean.set("object", params.object);
    redirect(`/v3/settings?${clean.toString()}`);
  }
  const journal = journalRead.entries;

  const query = (next: Record<string, string | undefined>) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(next)) if (value) search.set(key, value);
    const tail = search.toString();
    return tail ? `/v3/settings?${tail}` : "/v3/settings";
  };

  return (
    <PartShell
      title="Настройки"
    >
      <Settings
        section={section}
        // Authority grants access; presentation role controls the exact
        // interface while an admin previews Sales or Admissions.
        isAdmin={isAdmin}
        hrefFor={(next) => query({ section: next })}
        health={health}
        integrations={integrations}
        journal={journal}
        auditExportEnabled={readAuditExportEnabled()}
        journalFacets={journalFacets}
        journalFilters={journalFilters}
        // Параметр типизирован шире, чем требует Settings: сюда же приходит
        // курсор страницы журнала, а смена фильтра его не несёт — и тем
        // самым честно возвращает на первую страницу.
        journalHrefFor={(next: Readonly<{
          objectType?: string;
          snapshotAt?: string;
          snapshotId?: string;
          cursorAt?: string;
          cursorId?: string;
        }>) =>
          query({
            section: "journal",
            object: next.objectType,
            snapshot: next.snapshotAt,
            snapshotId: next.snapshotId,
            cursor: next.cursorAt,
            cursorId: next.cursorId,
          })
        }
        roles={readRoles()}
        capabilityNames={readCapabilityNames()}
        routeNames={readRouteNames()}
        gates={gates}
        platform={platform}
        staff={staff}
      />
    </PartShell>
  );
}
