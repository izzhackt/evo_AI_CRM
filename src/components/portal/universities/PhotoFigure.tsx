import { UniversityPhotoFrame } from "@/components/platform/universities/UniversityPhotoFrame";
import { UNIVERSITY_PHOTOS, type UniversityContent } from "@/lib/platform-university-catalog";
import type { PortalStrings } from "@/lib/portal/i18n";
import { universityPhotoCredit } from "@/lib/portal/university-tiles";
import { managedUniversityPhotoUrl, universityPhotoSrcSet } from "@/lib/university-photo-url";

import { PhotoRights, type PhotoRightsStrings } from "./PhotoRights";

/** Ширины уменьшенных копий фото-героя вуза: до ширины колонки. */
const HERO_WIDTHS = [800, 1200, 1600] as const;
const HERO_SIZES = "(min-width: 1100px) 1000px, 100vw";

export type PhotoFigureStrings = Pick<PortalStrings<"universities">, "photoFailed"> & PhotoRightsStrings;

/**
 * Фото-герой страницы вуза. Только managed-копия из нашего бакета, не
 * hotlink с сайта вуза (план 4.4, приёмка 7.6.5). Без копии героя нет
 * вовсе (review S3 веба, N6: пустой блок первым экраном ничего не говорил),
 * как и блока «Стоимость» без строк; заглушка «фото не добавлено» остаётся
 * на карточках вузов в сетке. Строки лицензии под фото нет; автор и
 * лицензия, у официальных медиа вуза «Фото: <вуз>, официальный сайт»,
 * открываются тихой кнопкой «©».
 */
export function PhotoFigure({
  content,
  strings,
}: {
  content: Pick<UniversityContent, "photoKey" | "name">;
  strings: PhotoFigureStrings;
}) {
  const photo = content.photoKey ? UNIVERSITY_PHOTOS[content.photoKey] : null;
  const src = managedUniversityPhotoUrl(content.photoKey);
  const credit = universityPhotoCredit(content.photoKey);
  const emptyClassName = "pt-photo-empty pt-photo-empty-large";
  if (!photo || src === null || credit === null) return null;
  return (
    <UniversityPhotoFrame
      src={src}
      srcSet={universityPhotoSrcSet(content.photoKey, HERO_WIDTHS)}
      sizes={HERO_SIZES}
      priority
      alt={photo.caption}
      className="pt-photo pt-photo-hero"
      imageClassName="pt-photo-img pt-photo-img-large"
      emptyClassName={emptyClassName}
      failedText={strings.photoFailed}
    >
      <PhotoRights credit={credit} universityName={content.name} strings={strings} placement="bottom" />
    </UniversityPhotoFrame>
  );
}
