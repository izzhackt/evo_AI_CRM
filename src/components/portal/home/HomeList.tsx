import Link from "next/link";
import type { ReactNode } from "react";

import type { Locale } from "@/lib/i18n-data";
import { getPortalStrings } from "@/lib/portal/i18n";

import { HomeCardHead } from "./HomeParts";

export type HomeListView = "universities" | "programs";

/** Якорь блока «Мой список» на «Главной»: к нему ведут вкладки и ссылки «Вузы»/«Программы». */
export const HOME_LIST_ANCHOR = "list";

/**
 * «Мой список» на «Главной» (#1355): вкладки «Вузы» и «Мои программы» с числом. Прежние плитки с теми же числами на
 * «Поступлении» не нужны — счёт стоит прямо во вкладке. `null` вместо числа — чтение не удалось. Содержимое вкладки
 * (`children`) приходит страницей: HomeFavorites, FavoritesSection или PreparationList. 18.11.2026: обычный вид —
 * карточка в левой колонке под «Что сделать сейчас» (`boxed`); «Всё избранное» со сравнением — во всю ширину под
 * колонками, без рамки вокруг своих карточек.
 */
export function HomeList({ view, favoritesCount, programsCount, locale, boxed = false, children }: Readonly<{
  view: HomeListView;
  favoritesCount: number | null;
  programsCount: number | null;
  locale: Locale;
  boxed?: boolean;
  children: ReactNode;
}>) {
  const home = getPortalStrings("home", locale);
  const admission = getPortalStrings("admission", locale);
  // Между вкладками карточки список стоит на месте и страница не прыгает. Из «Всего избранного» (во всю ширину внизу)
  // вкладка возвращает список в колонку наверху: тогда переход докручивает к #list.
  const scroll = boxed ? false : undefined;
  return (
    <section id={HOME_LIST_ANCHOR} aria-labelledby="home-list" className={boxed ? "pt-card pt-home-box pt-home-list" : "pt-home-list"}>
      <HomeCardHead id="home-list" title={home.listHeading} />
      <nav className="pt-pill-tabs" aria-label={admission.tabsLabel}>
        <Link
          className="pt-pill-tab"
          href={`/portal#${HOME_LIST_ANCHOR}`}
          scroll={scroll}
          aria-current={view === "universities" ? "true" : undefined}
        >
          {admission["tab.universities"]}
          {favoritesCount !== null ? <span className="pt-pill-count">{favoritesCount}</span> : null}
        </Link>
        <Link
          className="pt-pill-tab"
          href={`/portal?view=programs#${HOME_LIST_ANCHOR}`}
          scroll={scroll}
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
