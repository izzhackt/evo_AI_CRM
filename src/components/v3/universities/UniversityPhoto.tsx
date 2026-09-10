"use client";
/* eslint-disable @next/next/no-img-element -- Four licensed public Wikimedia files only; no image proxy or arbitrary remote fetch. */
import { useState } from "react";
import { UNIVERSITY_PHOTOS, type UniversityContent } from "@/lib/platform-university-catalog";

const THUMBNAILS = {
  sunway: "https://thumb.wikimedia.org/wikipedia/commons/thumb/8/8a/Cmglee_Sunway_University_new_building.jpg/1280px-Cmglee_Sunway_University_new_building.jpg",
  mmu: "https://thumb.wikimedia.org/wikipedia/commons/thumb/1/14/CYBER.jpg/1280px-CYBER.jpg",
  xjtlu: "https://thumb.wikimedia.org/wikipedia/commons/thumb/4/4c/XJTLU_Admin_Lib.JPG/1280px-XJTLU_Admin_Lib.JPG",
  unnc: "https://thumb.wikimedia.org/wikipedia/commons/thumb/9/9b/20230912_Ningbo_Nottingham_Daxue.jpg/1280px-20230912_Ningbo_Nottingham_Daxue.jpg",
} as const;
export function UniversityPhoto({ content, large = false }: { content: Pick<UniversityContent, "photoKey">; large?: boolean }) {
  const [failed, setFailed] = useState(false);
  const photo = content.photoKey ? UNIVERSITY_PHOTOS[content.photoKey] : null;
  if (!photo || !content.photoKey || failed) return <div className={`flex items-center justify-center rounded-card border border-border bg-surface-2 px-6 text-center text-sm text-fg-3 ${large ? "h-48" : "h-44"}`}>{failed ? "Не удалось загрузить фото кампуса" : "Проверенное фото кампуса пока не добавлено"}</div>;
  return <figure className="overflow-hidden rounded-card border border-border bg-surface">
    <img src={THUMBNAILS[content.photoKey]} alt={photo.caption} width={1280} height={850} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} className={`w-full object-cover ${large ? "h-56 sm:h-80" : "h-44"}`} />
    <figcaption className="px-3 py-2 text-xs leading-5 text-fg-3"><a href={photo.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline">Фото: {photo.author}</a> · <a href={photo.licenseUrl} target="_blank" rel="noopener noreferrer" className="underline">{photo.license}</a>. Миниатюра Wikimedia; кадрирование в карточке.</figcaption>
  </figure>;
}
