import Link from "next/link";
import type { ReactNode } from "react";

import type { Locale } from "@/lib/i18n-data";
import { getPortalStrings } from "@/lib/portal/i18n";

import { HomeCardHead } from "./HomeParts";

export type HomeListView = "universities" | "programs";

/** Якорь блока «Мой список» на «Моём поступлении»: к нему ведут вкладки и ссылки «Вузы»/«Программы». */
export const HOME_LIST_ANCHOR = "list";

/** «Моё поступление» (09.11.2026, пользователь): путь, выбранные вузы и программы — своя страница, не «Главная». */
export const ADMISSION_HREF = "/portal/admission";

/**
 * «Мой список» (#1355): вкладки «Вузы» и «Мои программы» с числом. С 09.11.2026 — на странице «Моё поступление»
 * (пользователь: «там и будут уники которые он выбрал и число програм и уников»), под путём поступления. Прежние
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
          href={`${ADMISSION_HREF}#${HOME_LIST_ANCHOR}`}
          scroll={false}
          aria-current={view === "universities" ? "true" : undefined}
        >
          {admission["tab.universities"]}
          {favoritesCount !== null ? <span className="pt-pill-count">{favoritesCount}</span> : null}
        </Link>
        <Link
          className="pt-pill-tab"
          href={`${ADMISSION_HREF}?view=programs#${HOME_LIST_ANCHOR}`}
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
