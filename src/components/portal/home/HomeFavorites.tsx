import { IntentPrefetchLink } from "@/components/IntentPrefetchLink";
import { UniversityPhotoFrame } from "@/components/platform/universities/UniversityPhotoFrame";

import type { Locale } from "@/lib/i18n-data";
import type { PublishedUniversity } from "@/lib/platform-university-catalog";
import { getPortalStrings } from "@/lib/portal/i18n";
import { universityTilePhoto } from "@/lib/portal/university-tiles";
import { universityCountryLabel } from "@/lib/portal/universities";

import { HomeCardHead, HomeEmpty } from "./HomeParts";

const PHOTO_SIZES = "(min-width: 960px) 260px, 50vw";

/**
 * «Мои вузы» на «Главной»: первые записи избранного карточками — фото кампуса и название, под ним город и страна
 * (09.11.2026, пользователь: «карточки типа фотка и название уника»). Вся карточка — ссылка на вуз. Полный список
 * со сравнением и «Моими программами» — «Моё поступление» (/portal/admission#list). Фото нет или оно не загрузилось —
 * серая подложка без надписи: название под ней. Пусто — значок и кнопка в каталог; `null` — чтение не удалось.
 */
export function HomeFavorites({ favorites, total, locale }: Readonly<{
  favorites: readonly PublishedUniversity[] | null;
  total: number;
  locale: Locale;
}>) {
  const strings = getPortalStrings("home", locale);
  const favoritesStrings = getPortalStrings("favorites", locale);

  return (
    <section aria-labelledby="home-favorites" className="pt-card pt-home-box pt-home-favorites">
      <HomeCardHead
        id="home-favorites"
        title={strings.favoritesHeading}
        count={favorites === null ? null : total}
        action={favorites !== null && total > 0 ? (
          <IntentPrefetchLink className="pt-link" href="/portal/admission#list">{strings.favoritesAll}</IntentPrefetchLink>
        ) : null}
      />
      {favorites === null ? (
        <p role="alert" className="pt-alert">{favoritesStrings.unavailable}</p>
      ) : favorites.length === 0 ? (
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
      ) : (
        <ul className="pt-home-fav-grid">
          {favorites.map((item) => {
            // Без ключа фото адрес не собирается вовсе: серая подложка без похода в настройки хранилища.
            const photo = item.content.photoKey ? universityTilePhoto(item.content.photoKey) : null;
            const country = universityCountryLabel(item.content.country, locale);
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
                </IntentPrefetchLink>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
