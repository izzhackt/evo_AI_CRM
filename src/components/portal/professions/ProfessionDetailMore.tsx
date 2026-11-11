import { Fragment } from "react";

import type { Locale } from "@/lib/i18n-data";
import type { PortalStrings } from "@/lib/portal/i18n";
import type { ProfessionCardBody } from "@/lib/portal/professions";

/**
 * «Подробнее о работе»: среда, интересное и сложное, пробное задание,
 * направления обучения и источник. Контент карточки сохраняется целиком, но
 * не загромождает страницу (правило плотности: второстепенное — свёрнуто).
 * Атрибуция O*NET обязательна (CC BY 4.0) и остаётся видимой под блоком.
 */
export function ProfessionDetailMore({
  body,
  locale,
  strings,
}: {
  body: ProfessionCardBody;
  locale: Locale;
  strings: PortalStrings<"professions">;
}) {
  const ky = locale === "ky";
  const lists = [
    { heading: strings.interestingHeading, items: ky ? body.interesting_ky : body.interesting_ru },
    { heading: strings.hardHeading, items: ky ? body.hard_ky : body.hard_ru },
    { heading: strings.studyHeading, items: ky ? body.study_directions_ky : body.study_directions_ru },
  ];
  return (
    <>
      <details className="pt-prof-more">
        <summary className="pt-prof-more-summary"><h2 className="pt-prof-more-heading">{strings.moreHeading}</h2></summary>
        <div className="pt-prof-more-body">
          <section>
            <h3 className="pt-prof-more-title">{strings.environmentHeading}</h3>
            <p>{ky ? body.environment_ky : body.environment_ru}</p>
          </section>
          {lists.map((list) => (
            <section key={list.heading}>
              <h3 className="pt-prof-more-title">{list.heading}</h3>
              <ul>
                {list.items.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </section>
          ))}
          <section>
            <h3 className="pt-prof-more-title">{strings.trialHeading}</h3>
            <p>{ky ? body.trial_task_ky : body.trial_task_ru}</p>
          </section>
        </div>
      </details>
      <footer className="pt-prof-attribution">
        <p>
          {strings.attribution}{" "}
          {body.sources.map((source, index) => (
            <Fragment key={source}>
              {index > 0 ? " · " : null}
              <a className="pt-prof-source" href={source} target="_blank" rel="noreferrer">
                {body.sources.length > 1 ? `${strings.sourcesHeading} ${index + 1}` : strings.sourcesHeading}
              </a>
            </Fragment>
          ))}
          {" · "}
          <a className="pt-prof-source" href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">
            {strings.attributionLink}
          </a>
        </p>
      </footer>
    </>
  );
}
