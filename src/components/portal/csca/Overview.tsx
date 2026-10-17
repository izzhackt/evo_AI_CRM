import { PhotoRights, type PhotoRightsStrings } from "@/components/portal/universities/PhotoRights";
import type { Locale } from "@/lib/i18n-data";
import { cscaDayLabel } from "@/lib/portal/csca";
import {
  CSCA_OVERVIEW,
  cscaMinutesLabel,
  cscaOverviewPhoto,
  cscaPhotoSources,
  cscaPhotoSrcSet,
  cscaScoreRangeLabel,
  type CscaEvoStatus,
  type CscaOverviewGroup,
  type CscaOverviewSubject,
  type CscaPhoto,
  type L10n,
} from "@/lib/portal/csca-overview";
import { formatPortalString, type PortalStrings } from "@/lib/portal/i18n";

import { cscaPhotoUrl } from "./overview-photo-files";
import { OverviewSheet } from "./OverviewSheet";

type Strings = PortalStrings<"csca">;

/**
 * Фото обзора: WebP 720 и 1280 и JPEG 720 запасным вариантом, файлы уже ужаты
 * под ширины (оптимизатор Next не нужен). Лицензия Pexels атрибуции не
 * требует, но портал подписывает фото (дизайн-контракт «Атлас»): автор и
 * лицензия по тихой кнопке «©», как у фото вузов.
 */
function OverviewPhoto({
  photo,
  locale,
  sizes,
  className,
  eager,
  rightsStrings,
}: {
  photo: CscaPhoto;
  locale: Locale;
  sizes: string;
  className: string;
  eager: boolean;
  rightsStrings: PhotoRightsStrings;
}) {
  const { webp, fallback } = cscaPhotoSources(photo);
  const large = webp.filter((file) => file.width >= 720);
  return (
    <figure className={className}>
      <picture>
        <source type="image/webp" srcSet={cscaPhotoSrcSet(large, cscaPhotoUrl)} sizes={sizes} />
        <img
          src={cscaPhotoUrl(fallback.path)}
          width={fallback.width}
          height={fallback.height}
          alt={photo.alt[locale === "ky" ? "ky" : "ru"]}
          loading={eager ? "eager" : "lazy"}
          fetchPriority={eager ? "high" : undefined}
          decoding="async"
          style={{ objectPosition: photo.objectPosition }}
        />
      </picture>
      <PhotoRights
        credit={{ kind: "author", author: photo.author, authorUrl: photo.sourceUrl, license: photo.licence, licenseUrl: photo.licenceUrl, source: null }}
        strings={rightsStrings}
        placement="bottom"
      />
    </figure>
  );
}

function Thumb({ photo }: { photo: CscaPhoto }) {
  const { webp, fallback } = cscaPhotoSources(photo);
  const small = webp.filter((file) => file.width < 720);
  return (
    <picture className="cs-ov-thumb">
      <source type="image/webp" srcSet={cscaPhotoSrcSet(small, cscaPhotoUrl)} sizes="72px" />
      <img src={cscaPhotoUrl(fallback.path)} width={fallback.width} height={fallback.height} alt="" loading="lazy" decoding="async" style={{ objectPosition: photo.objectPosition }} />
    </picture>
  );
}

function SubjectName({ subject, locale }: { subject: Pick<CscaOverviewSubject, "nameEn" | "name">; locale: Locale }) {
  const t = (text: L10n) => text[locale === "ky" ? "ky" : "ru"];
  return (
    <>
      <span className="cs-ov-subject-en" lang="en">{subject.nameEn}</span>
      {subject.name ? <span className="cs-ov-subject-local">{t(subject.name)}</span> : null}
    </>
  );
}

function EvoMark({ status, label }: { status: CscaEvoStatus; label: string }) {
  return <span className="cs-ov-evo" data-status={status}>{label}</span>;
}

/**
 * Таблица «Предметы и формат». Широкий контейнер: настоящая таблица с
 * группами (`th scope="rowgroup"`) и строкой на предмет. Узкий контейнер
 * (телефон, планшет с рейлом): тот же контент карточками со списком
 * «название: значение», без обрезанных столбцов. Видна одна из двух версий
 * (контейнерный запрос), скрытая убрана из дерева доступности.
 */
function SubjectsTable({ locale, groups }: { locale: Locale; groups: readonly CscaOverviewGroup[] }) {
  const o = CSCA_OVERVIEW;
  const lang = locale === "ky" ? "ky" : "ru";
  const t = (text: L10n) => text[lang];
  const columns = o.subjects.columns;
  const cells = (subject: CscaOverviewSubject) => [
    { key: "language", label: t(columns.language), value: t(subject.language) },
    { key: "duration", label: t(columns.duration), value: cscaMinutesLabel(o, subject.minutes, lang) },
    { key: "questions", label: t(columns.questions), value: String(subject.questions) },
    { key: "scoreRange", label: t(columns.scoreRange), value: cscaScoreRangeLabel(o, subject, lang) },
  ];
  return (
    <div className="cs-ov-subjects-frame">
      <div className="cs-ov-table-wide">
        <table className="cs-ov-table" aria-labelledby="cs-ov-subjects-title">
          <thead>
            <tr>
              <th scope="col">{t(columns.subject)}</th>
              <th scope="col">{t(columns.language)}</th>
              <th scope="col" className="cs-ov-num">{t(columns.duration)}</th>
              <th scope="col" className="cs-ov-num">{t(columns.questions)}</th>
              <th scope="col">{t(columns.scoreRange)}</th>
              <th scope="col">{t(columns.evo)}</th>
            </tr>
          </thead>
          {groups.map((group) => (
            <tbody key={group.key}>
              <tr className="cs-ov-group-row">
                <th scope="rowgroup" colSpan={6}>
                  <span lang="en">{group.nameEn}</span>
                  <span className="cs-ov-group-local">{t(group.name)}</span>
                </th>
              </tr>
              {group.subjects.map((subject) => (
                <tr key={subject.key}>
                  <th scope="row"><SubjectName subject={subject} locale={locale} /></th>
                  <td>{t(subject.language)}</td>
                  <td className="cs-ov-num">{cscaMinutesLabel(o, subject.minutes, lang)}</td>
                  <td className="cs-ov-num">{subject.questions}</td>
                  <td>{cscaScoreRangeLabel(o, subject, lang)}</td>
                  <td><EvoMark status={subject.evo} label={t(o.subjects.evoStatus[subject.evo])} /></td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
      <div className="cs-ov-table-narrow">
        {groups.map((group) => (
          <section key={group.key} className="cs-ov-card-group" aria-labelledby={`cs-ov-group-${group.key}`}>
            <h3 id={`cs-ov-group-${group.key}`} className="cs-ov-card-group-title">
              <span lang="en">{group.nameEn}</span>
              <span className="cs-ov-group-local">{t(group.name)}</span>
            </h3>
            <ul className="cs-ov-cards">
              {group.subjects.map((subject) => (
                <li key={subject.key} className="cs-ov-card">
                  <p className="cs-ov-card-name">
                    <SubjectName subject={subject} locale={locale} />
                    <EvoMark status={subject.evo} label={`${t(columns.evo)}: ${t(o.subjects.evoStatus[subject.evo])}`} />
                  </p>
                  <dl className="cs-ov-card-facts">
                    {cells(subject).map((cell) => (
                      <div key={cell.key} data-cell={cell.key}>
                        <dt>{cell.label}</dt>
                        <dd>{cell.value}</dd>
                      </div>
                    ))}
                  </dl>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

function VerdictIcon({ needed }: { needed: boolean }) {
  return (
    <svg className="cs-ov-verdict-icon" width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <circle cx="14" cy="14" r="13" fill={needed ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.5" />
      {needed ? (
        <path d="m8.5 14.5 3.6 3.5 7.4-8" stroke="var(--pt-surface)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <path d="M9 14h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      )}
    </svg>
  );
}

/**
 * Обзор экзамена (решение владельца 17.10.2026): что такое CSCA, кому он
 * нужен, предметы и формат, стоимость, вопросы. Факты из
 * src/content/csca/overview.json (подтвердил владелец), без прошедших дат:
 * вопрос «Когда проходит экзамен?» ведёт к блоку «Сессии CSCA» с календарём
 * csca.cn из базы. Логотипов CSC и CSCA и слов о партнёрстве нет.
 */
export function CscaOverview({
  locale,
  started,
  sessionsShown,
  moduleShown,
  strings,
  rightsStrings,
}: {
  locale: Locale;
  /** Студент уже занимается: обзор по умолчанию свёрнут. */
  started: boolean;
  /** На странице есть блок сессий, к нему ведёт ответ о датах. */
  sessionsShown: boolean;
  /** Занятия загрузились: под вводным текстом ссылка «К занятиям» на следующий шаг. */
  moduleShown: boolean;
  strings: Strings;
  rightsStrings: PhotoRightsStrings;
}) {
  const o = CSCA_OVERVIEW;
  const lang = locale === "ky" ? "ky" : "ru";
  const t = (text: L10n) => text[lang];
  const hero = cscaOverviewPhoto(o.photos.hero);
  const audiencePhoto = cscaOverviewPhoto(o.photos.audience);

  const head = (
    <>
      <h1 id="cs-title" className="cs-ov-title">{o.exam.short}</h1>
      <p className="cs-ov-name" lang="en">{o.exam.nameEn}</p>
    </>
  );

  const intro = (
    <div className="cs-ov-intro">
      {o.intro.map((paragraph, index) => (
        <p key={index} className={index === 0 ? "cs-ov-lead" : undefined}>{t(paragraph)}</p>
      ))}
      {moduleShown ? (
        // Кто уже знает экзамен, не листает обзор до занятий (critique раунда 2).
        <a className="cs-inline-link cs-ov-skip" href="#cs-next">
          {strings.overviewSkip}
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M8 3.5v9m0 0 4-4m-4 4-4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </a>
      ) : null}
    </div>
  );

  const body = (
    <>
      <section className="cs-ov-band cs-ov-audience" aria-labelledby="cs-ov-audience-title">
        <OverviewPhoto
          photo={audiencePhoto}
          locale={locale}
          sizes="(min-width: 1100px) 440px, 100vw"
          className="cs-ov-photo cs-ov-photo-audience"
          eager={false}
          rightsStrings={rightsStrings}
        />
        <div className="cs-ov-audience-text">
          <h2 id="cs-ov-audience-title" className="cs-ov-h2">{t(o.audience.title)}</h2>
          <dl className="cs-ov-verdicts">
            {([["needed", o.audience.needed], ["notNeeded", o.audience.notNeeded]] as const).map(([name, verdict]) => (
              <div key={name} className="cs-ov-verdict" data-verdict={name}>
                <dt>
                  <VerdictIcon needed={name === "needed"} />
                  {t(verdict.label)}
                </dt>
                <dd>{t(verdict.text)}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="cs-ov-band cs-ov-subjects" aria-labelledby="cs-ov-subjects-title">
        <h2 id="cs-ov-subjects-title" className="cs-ov-h2">{t(o.subjects.title)}</h2>
        <SubjectsTable locale={locale} groups={o.subjects.groups} />
      </section>

      <div className="cs-ov-band cs-ov-split">
        <section className="cs-ov-fees" aria-labelledby="cs-ov-fees-title">
          <h2 id="cs-ov-fees-title" className="cs-ov-h2">{t(o.fees.title)}</h2>
          <table className="cs-ov-table cs-ov-fees-table" aria-labelledby="cs-ov-fees-title">
            <thead>
              <tr>
                <th scope="col">{t(o.fees.columns.subjects)}</th>
                <th scope="col" className="cs-ov-num">{t(o.fees.columns.fee)}</th>
              </tr>
            </thead>
            <tbody>
              {o.fees.rows.map((row) => (
                <tr key={row.key}>
                  <th scope="row">{t(row.label)}</th>
                  <td className="cs-ov-num"><span className="cs-ov-amount">{row.fee}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="cs-ov-faq" aria-labelledby="cs-ov-faq-title">
          <h2 id="cs-ov-faq-title" className="cs-ov-h2">{t(o.faq.title)}</h2>
          <div className="cs-ov-faq-list">
            {o.faq.items.map((item) => (
              <details key={item.id} className="cs-ov-faq-item">
                <summary>
                  <span>{t(item.question)}</span>
                  <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </summary>
                <div className="cs-ov-faq-answer">
                  {item.link && !sessionsShown ? (
                    <p>{t(item.link.withoutSessions)}</p>
                  ) : (
                    item.answer.map((part, index) => <p key={index}>{t(part)}</p>)
                  )}
                  {item.link && sessionsShown ? (
                    <p>
                      <a className="cs-inline-link" href="#cs-sessions">{t(item.link.label)}</a>
                    </p>
                  ) : null}
                </div>
              </details>
            ))}
          </div>
        </section>
      </div>

      <p className="cs-ov-checked">
        {formatPortalString(strings.overviewChecked, { date: cscaDayLabel(o.confirmedOn, locale, true) })}
      </p>
    </>
  );

  return (
    <OverviewSheet
      defaultOpen={!started}
      toggleLabel={strings.overviewToggle}
      head={head}
      summary={<p className="cs-ov-summary">{t(o.summary)}</p>}
      intro={intro}
      photo={(
        <OverviewPhoto
          photo={hero}
          locale={locale}
          sizes="(min-width: 1100px) 560px, 100vw"
          className="cs-ov-photo cs-ov-photo-hero"
          eager={!started}
          rightsStrings={rightsStrings}
        />
      )}
      thumb={<Thumb photo={hero} />}
      body={body}
    />
  );
}
