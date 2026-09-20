"use client";
/* eslint-disable @next/next/no-img-element -- Reviewed fixed campus images; no arbitrary image proxy. */
import { useState } from "react";
import { UNIVERSITY_PHOTOS, type UniversityContent } from "@/lib/platform-university-catalog";
import { universityPhotoUrl } from "@/lib/university-photo-url";

export function UniversityPhoto({ content, large = false }: { content: Pick<UniversityContent, "photoKey">; large?: boolean }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const photo = content.photoKey ? UNIVERSITY_PHOTOS[content.photoKey] : null;
  // PORT-9d: managed-URL после migrated=true в манифесте, иначе прежний hotlink.
  const src = universityPhotoUrl(content.photoKey) ?? photo?.path ?? null;
  const failed = src !== null && failedUrl === src;
  if (!photo || src === null || failed) return <div className={`flex items-center justify-center rounded-card border border-border bg-surface-2 px-6 text-center text-sm text-fg-3 ${large ? "h-48" : "h-44"}`}>{failed ? "Не удалось загрузить фото кампуса" : "Проверенное фото кампуса пока не добавлено"}</div>;
  return <figure className="overflow-hidden rounded-card border border-border bg-surface">
    <img src={src} alt={photo.caption} width={1280} height={850} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailedUrl(src)} className={`w-full object-cover ${large ? "h-56 sm:h-80" : "h-44"}`} />
    <figcaption className="px-3 py-2 text-xs leading-5 text-fg-3"><p className="mb-1">{photo.caption}</p><a href={photo.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline">Фото: {photo.author}</a> · <a href={photo.licenseUrl} target="_blank" rel="noopener noreferrer" className="underline">{photo.license}</a>. Кадрирование в карточке.</figcaption>
  </figure>;
}
