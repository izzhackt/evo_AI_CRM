import { PartShell } from "@/components/v3/PartShell";
import { Settings } from "@/components/v3/settings/Settings";
import { isSectionKey } from "@/components/v3/settings/types";
import {
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
  const journalFilters = { objectType: params.object, role: params.role };

  const [health, integrations, journal, journalFacets, gates, platform] = await Promise.all([
    readHealth(),
    readIntegrations(),
    readJournal(journalFilters),
    readJournalFacets(),
    readGateFacts(),
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
      lead="Разделы слева, содержимое справа. Экран только для чтения: флаги живут в файлах окружения на сервере, и менять их из браузера нельзя — поэтому рядом с выключенным стоит не тумблер, а адрес."
    >
      <Settings
        section={section}
        // Часть смотрится под администратором; под другой ролью два раздела
        // из рельса просто не появятся.
        isAdmin
        hrefFor={(next) => query({ section: next })}
        health={health}
        integrations={integrations}
        journal={journal}
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
