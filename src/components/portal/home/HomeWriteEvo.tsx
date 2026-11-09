import { IntentPrefetchLink } from "@/components/IntentPrefetchLink";

import type { Locale } from "@/lib/i18n-data";
import { getPortalStrings } from "@/lib/portal/i18n";
import { WRITE_EVO_HREF } from "@/lib/portal/write-evo";

import { accountInitials } from "../initials";
import { HomeCardHead } from "./HomeParts";

/**
 * «Написать EVO» на «Главной» клиента с сопровождением (#1356): один вход к команде — чат во «Входящих». Прежний
 * блок «Вопрос куратору» на «Поступлении» снят: вопрос и ответ идут одной лентой.
 *
 * 09.11.2026 (разбор кабинета: «имя и фото менеджера с кнопкой связи»): над кнопкой — куратор дела из обзора. Фото
 * сотрудников в базе нет, поэтому вместо фото — инициалы в нейтральном круге, как у аккаунта в меню. Без куратора
 * строки нет: вход в чат тот же.
 */
export function HomeWriteEvo({ curatorName = null, locale }: Readonly<{
  /** Имя куратора дела; `null` — куратор ещё не назначен. */
  curatorName?: string | null;
  locale: Locale;
}>) {
  const strings = getPortalStrings("home", locale);
  return (
    <section aria-labelledby="home-write" className="pt-card pt-home-box pt-home-write">
      <HomeCardHead id="home-write" title={strings.writeHeading} />
      {curatorName ? (
        <div className="pt-home-manager-row" data-testid="home-curator">
          <span className="pt-home-manager-initials" aria-hidden="true">{accountInitials(curatorName)}</span>
          <p className="pt-home-manager-text">
            <span className="pt-home-manager-name">{curatorName}</span>
            <span className="pt-home-manager-role">{strings.managerRole}</span>
          </p>
        </div>
      ) : null}
      <p className="pt-home-foot">{strings.writeBody}</p>
      <p className="pt-home-case-actions">
        <IntentPrefetchLink href={WRITE_EVO_HREF} className="pt-btn">{strings.writeAction}</IntentPrefetchLink>
      </p>
    </section>
  );
}
