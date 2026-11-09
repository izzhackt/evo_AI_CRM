import { IntentPrefetchLink } from "@/components/IntentPrefetchLink";

import type { Locale } from "@/lib/i18n-data";
import { getPortalStrings } from "@/lib/portal/i18n";

import { accountInitials } from "../initials";
import { HomeCardHead } from "./HomeParts";

/**
 * «Ваш менеджер» на «Главной» клиента (09.11.2026, разбор кабинета: «имя и фото менеджера с кнопкой связи»): куратор
 * дела из обзора и «Написать» — переход во «Входящие», где у студента чат с EVO. Фото сотрудников в базе нет, поэтому
 * вместо фото — инициалы в нейтральном круге, как у аккаунта в меню. Без куратора — честная строка и тот же чат.
 */
export function HomeManager({ name, locale }: Readonly<{
  /** Имя куратора дела; `null` — куратор ещё не назначен. */
  name: string | null;
  locale: Locale;
}>) {
  const strings = getPortalStrings("home", locale);
  return (
    <section aria-labelledby="home-manager" className="pt-card pt-home-box pt-home-manager">
      <HomeCardHead id="home-manager" title={strings.managerHeading} />
      <div className="pt-home-manager-row">
        {name ? (
          <>
            <span className="pt-home-manager-initials" aria-hidden="true">{accountInitials(name)}</span>
            <p className="pt-home-manager-text">
              <span className="pt-home-manager-name">{name}</span>
              <span className="pt-home-manager-role">{strings.managerRole}</span>
            </p>
          </>
        ) : (
          <p className="pt-home-manager-role">{strings.managerNone}</p>
        )}
        <IntentPrefetchLink href="/portal/messages" className="pt-btn pt-home-manager-write">{strings.managerWrite}</IntentPrefetchLink>
      </div>
    </section>
  );
}
