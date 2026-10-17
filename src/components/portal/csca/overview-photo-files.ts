import type { StaticImageData } from "next/image";

import sichuan240 from "../../../content/csca/photos/campus-sichuan-240.webp";
import sichuan720 from "../../../content/csca/photos/campus-sichuan-720.webp";
import sichuan1280 from "../../../content/csca/photos/campus-sichuan-1280.webp";
import sichuan720Jpeg from "../../../content/csca/photos/campus-sichuan-720.jpg";
import xiamen720 from "../../../content/csca/photos/campus-xiamen-720.webp";
import xiamen1280 from "../../../content/csca/photos/campus-xiamen-1280.webp";
import xiamen720Jpeg from "../../../content/csca/photos/campus-xiamen-720.jpg";

/**
 * Файлы фото обзора статическим импортом (как логотип EVO): сборка отдаёт
 * их из /_next/static/media с хешем в имени и долгим кэшем, мимо прокси
 * кабинета. Ключ: путь из манифеста src/content/csca/photos.json; тест
 * tests/portal-csca-overview.test.mjs сверяет список с манифестом.
 */
export const CSCA_OVERVIEW_PHOTO_FILES: Readonly<Record<string, StaticImageData>> = Object.freeze({
  "photos/campus-sichuan-240.webp": sichuan240,
  "photos/campus-sichuan-720.webp": sichuan720,
  "photos/campus-sichuan-1280.webp": sichuan1280,
  "photos/campus-sichuan-720.jpg": sichuan720Jpeg,
  "photos/campus-xiamen-720.webp": xiamen720,
  "photos/campus-xiamen-1280.webp": xiamen1280,
  "photos/campus-xiamen-720.jpg": xiamen720Jpeg,
});

export function cscaPhotoUrl(path: string): string {
  const file = CSCA_OVERVIEW_PHOTO_FILES[path];
  if (!file) throw new Error(`csca overview photo ${path} is not bundled`);
  return file.src;
}
