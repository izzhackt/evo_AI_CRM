import Link from "next/link";
import type { ReactNode } from "react";

import type { Locale } from "@/lib/i18n-data";
import { getPortalStrings } from "@/lib/portal/i18n";

import { HomeCardHead } from "./HomeParts";

export type HomeListView = "universities" | "programs";

/** Якорь блока «Мой список» на «Главной»: к нему ведут вкладки и ссылки «Вузы»/«Программы». */
export const HOME_LIST_ANCHOR = "list";

/**
 * «Мой список» на «Главной» (#1355): вкладки «Вузы» и «Мои программы» с числом под колонками «Главной». Прежние
 * плитки с теми же числами на «Поступлении» не нужны — счёт стоит прямо во вкладке. `null` вместо числа — чтение не
 * удалось. Содержимое вкладки (`children`) приходит страницей: FavoritesSection или PreparationList.
 */
export function HomeList({ view, favoritesCount, programsCount, locale, children }: Readonly<{
  view: HomeListView;
  favoritesCount: number | null;
  programsCount: number | null;
  locale: Locale;
  children: ReactNode;
}>) {
  const home = getPortalStrings("home", locale);
  const admission = getPortalStrings("admission", locale);
  return (
    <section id={HOME_LIST_ANCHOR} aria-labelledby="home-list" className="pt-home-list">
      <HomeCardHead id="home-list" title={home.listHeading} />
      <nav className="pt-pill-tabs" aria-label={admission.tabsLabel}>
        <Link
          className="pt-pill-tab"
          href={`/portal#${HOME_LIST_ANCHOR}`}
          scroll={false}
          aria-current={view === "universities" ? "true" : undefined}
        >
          {admission["tab.universities"]}
          {favoritesCount !== null ? <span className="pt-pill-count">{favoritesCount}</span> : null}
        </Link>
        <Link
          className="pt-pill-tab"
          href={`/portal?view=programs#${HOME_LIST_ANCHOR}`}
          scroll={false}
          aria-current={view === "programs" ? "true" : undefined}
        >
          {admission["tab.programs"]}
          {programsCount !== null ? <span className="pt-pill-count">{programsCount}</span> : null}
        </Link>
      </nav>
      {children}
    </section>
  );
}
