"use client";
/* eslint-disable @next/next/no-img-element -- Exact licensed public Wikimedia files only; no image proxy or arbitrary remote fetch. */
import { useState } from "react";
import { UNIVERSITY_PHOTOS, type UniversityContent } from "@/lib/platform-university-catalog";

const THUMBNAILS = {
  sunway: "https://thumb.wikimedia.org/wikipedia/commons/thumb/8/8a/Cmglee_Sunway_University_new_building.jpg/1280px-Cmglee_Sunway_University_new_building.jpg",
  mmu: "https://thumb.wikimedia.org/wikipedia/commons/thumb/1/14/CYBER.jpg/1280px-CYBER.jpg",
  xjtlu: "https://thumb.wikimedia.org/wikipedia/commons/thumb/4/4c/XJTLU_Admin_Lib.JPG/1280px-XJTLU_Admin_Lib.JPG",
  unnc: "https://thumb.wikimedia.org/wikipedia/commons/thumb/9/9b/20230912_Ningbo_Nottingham_Daxue.jpg/1280px-20230912_Ningbo_Nottingham_Daxue.jpg",
  "taylors": "https://upload.wikimedia.org/wikipedia/commons/thumb/8/87/Taylor%27s_Lakeside_Campus%2C_Subang_Jaya%2C_Malaysia.jpg/960px-Taylor%27s_Lakeside_Campus%2C_Subang_Jaya%2C_Malaysia.jpg",
  "inti": "https://thumb.wikimedia.org/wikipedia/commons/thumb/5/50/INTI_Nilai_Student_Centre.png/330px-INTI_Nilai_Student_Centre.png",
  "ucsi": "https://thumb.wikimedia.org/wikipedia/commons/thumb/4/46/UCSI_main_gate_Taman_Connaught_%28231105%29.jpg/960px-UCSI_main_gate_Taman_Connaught_%28231105%29.jpg",
  "xiamen-malaysia": "https://upload.wikimedia.org/wikipedia/commons/thumb/5/50/XMUM_entrance_%28211127%29.jpg/960px-XMUM_entrance_%28211127%29.jpg",
  "monash-malaysia": "https://thumb.wikimedia.org/wikipedia/commons/thumb/7/77/Monash_University_Malaysia_%28221208%29_01.jpg/960px-Monash_University_Malaysia_%28221208%29_01.jpg",
  "scut": "https://thumb.wikimedia.org/wikipedia/commons/thumb/1/13/South_China_University_of_Technology_South_Campus.jpg/960px-South_China_University_of_Technology_South_Campus.jpg",
  "zjut": "https://thumb.wikimedia.org/wikipedia/commons/thumb/e/e3/20250423_Zhejiang_Gongye_Daxue.jpg/960px-20250423_Zhejiang_Gongye_Daxue.jpg",
  "gdut": "https://thumb.wikimedia.org/wikipedia/commons/thumb/d/d6/%E5%B9%BF%E5%B7%A5%E5%A4%A7%E4%B8%9C%E9%A3%8E%E8%B7%AF%E6%A0%A1%E5%8C%BA%E5%8D%97%E8%8B%91%E5%A4%A7%E9%97%A8.jpg/960px-%E5%B9%BF%E5%B7%A5%E5%A4%A7%E4%B8%9C%E9%A3%8E%E8%B7%AF%E6%A0%A1%E5%8C%BA%E5%8D%97%E8%8B%91%E5%A4%A7%E9%97%A8.jpg",
  "upc-east-china": "https://thumb.wikimedia.org/wikipedia/commons/thumb/8/8e/%E4%B8%AD%E5%9B%BD%E7%9F%B3%E6%B2%B9%E5%A4%A7%E5%AD%A6%E9%BB%84%E5%B2%9B%E6%A0%A1%E5%8C%BA%E5%8D%97%E4%BE%A7.jpg/960px-%E4%B8%AD%E5%9B%BD%E7%9F%B3%E6%B2%B9%E5%A4%A7%E5%AD%A6%E9%BB%84%E5%B2%9B%E6%A0%A1%E5%8C%BA%E5%8D%97%E4%BE%A7.jpg",
  "ecust": "https://thumb.wikimedia.org/wikipedia/commons/thumb/e/e5/ECUST_gate_Xuhui.jpg/960px-ECUST_gate_Xuhui.jpg",
} as const satisfies Record<NonNullable<UniversityContent["photoKey"]>, string>;
export function UniversityPhoto({ content, large = false }: { content: Pick<UniversityContent, "photoKey">; large?: boolean }) {
  const [failed, setFailed] = useState(false);
  const photo = content.photoKey ? UNIVERSITY_PHOTOS[content.photoKey] : null;
  if (!photo || !content.photoKey || failed) return <div className={`flex items-center justify-center rounded-card border border-border bg-surface-2 px-6 text-center text-sm text-fg-3 ${large ? "h-48" : "h-44"}`}>{failed ? "Не удалось загрузить фото кампуса" : "Проверенное фото кампуса пока не добавлено"}</div>;
  return <figure className="overflow-hidden rounded-card border border-border bg-surface">
    <img src={THUMBNAILS[content.photoKey]} alt={photo.caption} width={1280} height={850} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} className={`w-full object-cover ${large ? "h-56 sm:h-80" : "h-44"}`} />
    <figcaption className="px-3 py-2 text-xs leading-5 text-fg-3"><a href={photo.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline">Фото: {photo.author}</a> · <a href={photo.licenseUrl} target="_blank" rel="noopener noreferrer" className="underline">{photo.license}</a>. Миниатюра Wikimedia; кадрирование в карточке.</figcaption>
  </figure>;
}
