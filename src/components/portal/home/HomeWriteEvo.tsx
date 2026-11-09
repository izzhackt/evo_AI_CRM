import { IntentPrefetchLink } from "@/components/IntentPrefetchLink";

import type { Locale } from "@/lib/i18n-data";
import { getPortalStrings } from "@/lib/portal/i18n";
import { WRITE_EVO_HREF } from "@/lib/portal/write-evo";

import { HomeCardHead } from "./HomeParts";

/**
 * «Написать EVO» на «Главной» клиента с сопровождением (#1356): один вход к команде — чат во «Входящих». Прежний
 * блок «Вопрос куратору» на «Поступлении» снят: вопрос и ответ идут одной лентой.
 */
export function HomeWriteEvo({ locale }: Readonly<{ locale: Locale }>) {
  const strings = getPortalStrings("home", locale);
  return (
    <section aria-labelledby="home-write" className="pt-card pt-home-box pt-home-write">
      <HomeCardHead id="home-write" title={strings.writeHeading} />
      <p className="pt-home-foot">{strings.writeBody}</p>
      <p className="pt-home-case-actions">
        <IntentPrefetchLink href={WRITE_EVO_HREF} className="pt-btn">{strings.writeAction}</IntentPrefetchLink>
      </p>
    </section>
  );
}
