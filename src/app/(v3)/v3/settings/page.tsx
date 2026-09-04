import { PartShell } from "@/components/v3/PartShell";
import { Settings } from "@/components/v3/settings/Settings";
import { isSectionKey } from "@/components/v3/settings/types";
import { requirePlatformCapability } from "@/lib/platform-guards";
import { normalizeJournalFilters } from "@/lib/v3/settings-journal-contract";
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
  searchParams: Promise<{ section?: string; object?: string; role?: string }>;
}) {
  const params = await searchParams;
  const section = isSectionKey(params.section) ? params.section : "state";
  const journalFilters = normalizeJournalFilters({
    objectType: params.object,
    role: params.role,
  });
  const actor = await requirePlatformCapability("admin.preview", "/v3/settings");
  const isAdmin = actor.authorityRole === "admin" && actor.presentationRole === "admin";

  const [health, integrations, journal, journalFacets, gates, platform] = await Promise.all([
    readHealth(actor),
    readIntegrations(actor),
    isAdmin ? readJournal(actor, journalFilters) : Promise.resolve([]),
    isAdmin
      ? readJournalFacets(actor)
      : Promise.resolve({ objectTypes: [], roles: [] }),
    readGateFacts(actor),
    readPlatformFact(),
  ]);

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
        journalHrefFor={(next) =>
          query({ section: "journal", object: next.objectType, role: next.role })
        }
        roles={readRoles()}
        capabilityNames={readCapabilityNames()}
        routeNames={readRouteNames()}
        gates={gates}
        platform={platform}
      />
    </PartShell>
  );
}
