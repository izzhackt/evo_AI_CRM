import Link from "next/link";

import type { PortalStrings } from "@/lib/portal/i18n";

export type ProfessionsView = "catalog" | "evi";

/** Вкладки «Каталог | Подбор с Эви» под заголовком «Профессий» (решение владельца 16.11.2026), как «Мой список» на «Главной». */
export function ProfessionsTabs({ view, strings }: Readonly<{
  view: ProfessionsView;
  strings: PortalStrings<"professions">;
}>) {
  return (
    <nav className="pt-pill-tabs" aria-label={strings.tabsLabel}>
      <Link
        className="pt-pill-tab"
        href="/portal/professions"
        aria-current={view === "catalog" ? "true" : undefined}
      >
        {strings["tab.catalog"]}
      </Link>
      <Link
        className="pt-pill-tab"
        href="/portal/professions?view=evi"
        aria-current={view === "evi" ? "true" : undefined}
      >
        {strings["tab.evi"]}
      </Link>
    </nav>
  );
}
