"use client";
/* eslint-disable @next/next/no-img-element -- Проверенные фиксированные фото кампусов из фото-библиотеки; произвольного image-прокси нет (то же правило, что у staff UniversityPhoto). */

import { useState } from "react";

import { UNIVERSITY_PHOTOS, type UniversityContent } from "@/lib/platform-university-catalog";
import { formatPortalString, type PortalStrings } from "@/lib/portal/i18n";

export type PhotoFigureStrings = Pick<
  PortalStrings<"universities">,
  "photoMissing" | "photoFailed" | "photoBy" | "photoCrop" | "newTab"
>;

/**
 * Фото кампуса с сохранённой атрибуцией CC (PORT-3a): подпись, автор со
 * ссылкой на источник, лицензия со ссылкой и пометка о кадрировании — тот же
 * атрибуционный UX, что в staff-каталоге, но на портальных токенах и
 * словаре RU/KY.
 */
export function PhotoFigure({
  content,
  large = false,
  strings,
}: {
  content: Pick<UniversityContent, "photoKey">;
  large?: boolean;
  strings: PhotoFigureStrings;
}) {
  const [failed, setFailed] = useState(false);
  const photo = content.photoKey ? UNIVERSITY_PHOTOS[content.photoKey] : null;
  if (!photo || failed) {
    return (
      <div className={`pt-photo-empty${large ? " pt-photo-empty-large" : ""}`}>
        {failed ? strings.photoFailed : strings.photoMissing}
      </div>
    );
  }
  return (
    <figure className="pt-photo">
      <img
        src={photo.path}
        alt={photo.caption}
        width={1280}
        height={850}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className={`pt-photo-img${large ? " pt-photo-img-large" : ""}`}
      />
      <figcaption className="pt-photo-caption">
        <span className="pt-photo-caption-title">{photo.caption}</span>
        <span>
          <a href={photo.sourceUrl} target="_blank" rel="noopener noreferrer">
            {formatPortalString(strings.photoBy, { author: photo.author })}
            <span className="pt-sr-only"> {strings.newTab}</span>
          </a>
          {" · "}
          <a href={photo.licenseUrl} target="_blank" rel="noopener noreferrer">
            {photo.license}
            <span className="pt-sr-only"> {strings.newTab}</span>
          </a>
          {". "}
          {strings.photoCrop}
        </span>
      </figcaption>
    </figure>
  );
}
