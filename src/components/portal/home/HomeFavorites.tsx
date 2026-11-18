import { IntentPrefetchLink } from "@/components/IntentPrefetchLink";
import { UniversityPhotoFrame } from "@/components/platform/universities/UniversityPhotoFrame";

import type { Locale } from "@/lib/i18n-data";
import type { PublishedUniversity } from "@/lib/platform-university-catalog";
import { getPortalStrings } from "@/lib/portal/i18n";
import { intakeText, universityTilePhoto } from "@/lib/portal/university-tiles";
import { nearestUniversityIntake, universityCountryLabel } from "@/lib/portal/universities";

import { HomeFavoritesStrip } from "./HomeFavoritesStrip";
import { HomeEmpty } from "./HomeParts";

// В левой колонке две карточки в ряд (около 290 px), во всю ширину четыре, на телефоне лента вбок (около 80% экрана).
const PHOTO_SIZES = "(min-width: 960px) 300px, (min-width: 768px) 45vw, 80vw";

/** Куда ведёт «Всё избранное»: тот же блок «Мой список», но с полным списком и сравнением (FavoritesSection). */
export const HOME_FAVORITES_ALL_HREF = "/portal?all=1#list";

/**
 * Вкладка «Вузы» в «Моём списке» на «Главной»: первые записи избранного карточками — фото кампуса и название, под
 * ним город и страна (09.11.2026, пользователь: «карточки типа фотка и название уника»; перенесено из #1423, Айвар).
 * Вся карточка — ссылка на вуз. «Всё избранное» открывает полный список со сравнением. Фото берётся только из нашего
 * бакета (universityTilePhoto); нет фото или оно не загрузилось — серая подложка без надписи, название под ней.
 * Пусто — значок и кнопка в каталог; `null` — чтение не удалось. 18.11.2026: в левой колонке под «Что сделать сейчас»
 * две карточки в ряд, во всю ширину четыре, на телефоне лента вбок; под названием — ближайший срок подачи или старт
 * тем же текстом, что у карточек каталога; без открытого набора строки нет.
 */
export function HomeFavorites({ favorites, total, locale, now }: Readonly<{
  favorites: readonly PublishedUniversity[] | null;
  total: number;
  locale: Locale;
  now: Date;
}>) {
  const strings = getPortalStrings("home", locale);
  const favoritesStrings = getPortalStrings("favorites", locale);
  const universityStrings = getPortalStrings("universities", locale);

  if (favorites === null) return <p role="alert" className="pt-alert">{favoritesStrings.unavailable}</p>;
  if (favorites.length === 0) {
    return (
      <HomeEmpty
        icon="universities"
        title={favoritesStrings.emptyTitle}
        body={favoritesStrings.emptyBody}
        action={(
          <IntentPrefetchLink href="/portal/universities" className="pt-btn-ghost">
            {favoritesStrings.emptyAction}
          </IntentPrefetchLink>
        )}
      />
    );
  }

  return (
    <>
      <HomeFavoritesStrip>
        {favorites.map((item) => {
          // Без ключа фото адрес не собирается вовсе: серая подложка без похода в настройки хранилища.
          const photo = item.content.photoKey ? universityTilePhoto(item.content.photoKey) : null;
          const country = universityCountryLabel(item.content.country, locale);
          const nearest = nearestUniversityIntake(item.content, now);
          const intake = nearest ? intakeText(nearest, universityStrings, locale) : null;
          return (
            <li key={item.id}>
              <IntentPrefetchLink href={`/portal/universities/${item.id}`} className="pt-home-fav-card">
                {photo ? (
                  <UniversityPhotoFrame
                    src={photo.src}
                    srcSet={photo.srcSet}
                    sizes={PHOTO_SIZES}
                    alt=""
                    className="pt-home-fav-photo"
                    imageClassName="pt-photo-img"
                    emptyClassName="pt-home-fav-photo pt-photo-empty"
                    failedText=""
                  >
                    {null}
                  </UniversityPhotoFrame>
                ) : (
                  <span className="pt-home-fav-photo pt-photo-empty" aria-hidden="true" />
                )}
                <span className="pt-home-fav-name">{item.content.name}</span>
                <span className="pt-home-fav-place">{item.content.city ? `${item.content.city} · ${country}` : country}</span>
                {intake ? <span className="pt-home-fav-intake">{intake}</span> : null}
              </IntentPrefetchLink>
            </li>
          );
        })}
      </HomeFavoritesStrip>
      {total > 0 ? (
        <p className="pt-home-fav-more">
          <IntentPrefetchLink className="pt-link" href={HOME_FAVORITES_ALL_HREF}>{strings.favoritesAll}</IntentPrefetchLink>
        </p>
      ) : null}
    </>
  );
}
