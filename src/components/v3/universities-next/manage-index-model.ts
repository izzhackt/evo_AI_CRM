import { manageEditorHref, manageListContext, manageListHref, type ManageIndex } from "@/lib/university-manage-contract";
import type { UniversityContent, UniversityDraft } from "@/lib/platform-university-catalog";

import type { ManageIndexProps } from "./manage-index-types";

type Template = Readonly<{ key: string; content: Pick<UniversityContent, "name" | "country"> }>;

/**
 * Свойства индекса «Управления каталогом»: те же черновики, подготовленные сведения по странам и адреса, что собирала
 * прежняя страница (`manageEditorHref`, `manageListHref`). Подготовленные сведения — по странам, по названию; поиск раскрывает совпавшие группы.
 */
export function manageIndexProps(args: Readonly<{
  index: ManageIndex;
  page: Readonly<{ items: readonly Pick<UniversityDraft, "id" | "baseVersion" | "content">[]; nextCursor: string | null }> | null;
  templates: readonly Template[];
  countryLabel: (code: string) => string;
}>): ManageIndexProps {
  const { index, page, templates } = args;
  const listContext = manageListContext(index);
  const matching = templates.filter((item) => item.content.name.toLowerCase().includes(index.q.toLowerCase()));
  const byCountry = new Map<string, Template[]>();
  for (const item of matching) byCountry.set(item.content.country, [...(byCountry.get(item.content.country) ?? []), item]);
  const groups = [...byCountry]
    .map(([code, items]) => ({
      code, label: args.countryLabel(code),
      items: [...items].sort((a, b) => a.content.name.localeCompare(b.content.name, "en")).map((item) => ({ key: item.key, name: item.content.name, href: manageEditorHref("template", item.key, listContext) })),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, "ru"));
  return {
    query: index.q,
    resetHref: index.q || index.cursor ? "/v3/universities/manage" : null,
    drafts: page === null ? null : {
      rows: page.items.map((draft) => ({ id: draft.id, name: draft.content.name, baseVersion: draft.baseVersion, href: manageEditorHref("draft", draft.id, listContext) })),
      emptyText: index.q ? "Черновиков с таким названием нет." : index.cursor ? "На этой странице черновиков нет." : "Нет черновиков.",
      firstHref: index.cursor ? manageListHref({ q: index.q, cursor: null }) : null,
      nextHref: page.nextCursor ? manageListHref({ q: index.q, cursor: page.nextCursor }) : null,
    },
    batchHref: manageEditorHref("batch", "1", listContext),
    groups,
    groupsEmptyText: "Подготовленных материалов с таким названием нет.",
  };
}
