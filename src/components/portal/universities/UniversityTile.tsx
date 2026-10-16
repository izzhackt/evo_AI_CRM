import { IntentPrefetchLink } from "@/components/IntentPrefetchLink";
import { UniversityPhotoFrame } from "@/components/platform/universities/UniversityPhotoFrame";

import { FavoriteToggle, type FavoriteToggleStrings } from "./FavoriteToggle";

/**
 * Карточка вуза «Атласа» (S3): одна для города, «Других вузов страны»,
 * поиска и «Избранного». Данные уже подготовлены сервером (фото нужного
 * размера, подписи уровней, ближайший набор), поэтому карточку рисует и
 * серверная страница, и клиентский поиск. Подписи лицензии под фото нет
 * (приёмка 7.6.5): сведения о фото остаются в данных.
 */

export type TilePhoto = Readonly<{ src: string; srcSet: string | null; alt: string }>;

export type UniversityTileModel = Readonly<{
  id: string;
  name: string;
  href: string;
  /** «Город · Страна»; null: карточка уже внутри города. */
  place: string | null;
  levels: readonly string[];
  intakeText: string;
  photo: TilePhoto | null;
  /** null: состояние избранного неизвестно (сердечко не показывается). */
  favored: boolean | null;
}>;

export type UniversityTileStrings = FavoriteToggleStrings & Readonly<{
  levelLabel: string;
  nearestIntake: string;
  openCard: string;
  photoMissing: string;
  photoFailed: string;
}>;

const TILE_SIZES = "(min-width: 1180px) 360px, (min-width: 640px) 45vw, 100vw";

export function UniversityTile({
  model,
  strings,
  priority = false,
  headingLevel = 3,
}: {
  model: UniversityTileModel;
  strings: UniversityTileStrings;
  /** Первые карточки экрана: фото грузится сразу, не лениво. */
  priority?: boolean;
  headingLevel?: 2 | 3;
}) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <article className="pt-uni-card">
      <div className="pt-uni-card-media">
      {model.photo ? (
        <UniversityPhotoFrame
          src={model.photo.src}
          srcSet={model.photo.srcSet}
          sizes={TILE_SIZES}
          priority={priority}
          alt={model.photo.alt}
          className="pt-photo pt-uni-card-photo"
          imageClassName="pt-photo-img"
          emptyClassName="pt-photo-empty"
          failedText={strings.photoFailed}
        >
          {null}
        </UniversityPhotoFrame>
      ) : (
        <div className="pt-photo-empty">{strings.photoMissing}</div>
      )}
      {model.favored !== null ? (
        // Сердечко лежит на фото: строка над названием не пустует, когда
        // карточка уже внутри города (места нет).
        <div className="pt-uni-card-fav">
          <FavoriteToggle
            institutionId={model.id}
            initialFavored={model.favored}
            universityName={model.name}
            strings={{
              favoriteAdd: strings.favoriteAdd,
              favoriteRemove: strings.favoriteRemove,
              favoriteError: strings.favoriteError,
            }}
          />
        </div>
      ) : null}
      </div>
      <div className="pt-uni-card-body">
        {model.place ? <p className="pt-uni-meta">{model.place}</p> : null}
        <Heading className="pt-uni-name">
          <IntentPrefetchLink href={model.href}>{model.name}</IntentPrefetchLink>
        </Heading>
        {model.levels.length > 0 ? (
          <ul className="pt-chip-row" aria-label={strings.levelLabel}>
            {model.levels.map((level) => (
              <li key={level} className="pt-chip">{level}</li>
            ))}
          </ul>
        ) : null}
        <p className="pt-uni-intake">
          <span>{strings.nearestIntake}: </span>
          <span className="pt-data">{model.intakeText}</span>
        </p>
        <IntentPrefetchLink className="pt-btn-ghost pt-uni-card-action" href={model.href}>
          {strings.openCard}
          <span className="pt-sr-only">, {model.name}</span>
        </IntentPrefetchLink>
      </div>
    </article>
  );
}

export function UniversityTileGrid({
  models,
  strings,
  priorityCount = 3,
  headingLevel = 3,
  label,
}: {
  models: readonly UniversityTileModel[];
  strings: UniversityTileStrings;
  priorityCount?: number;
  headingLevel?: 2 | 3;
  label?: string;
}) {
  return (
    <ul className="pt-uni-grid" aria-label={label}>
      {models.map((model, index) => (
        <li key={model.id}>
          <UniversityTile model={model} strings={strings} priority={index < priorityCount} headingLevel={headingLevel} />
        </li>
      ))}
    </ul>
  );
}
