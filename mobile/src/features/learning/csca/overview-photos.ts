// Файлы фото обзора CSCA (те же WebP, что у веба и iPhone, копий нет): ключ — путь из манифеста
// src/content/csca/photos.json. Metro читает их из <repo>/src (watchFolders).
import type { ImageSourcePropType } from "react-native";
import { PixelRatio } from "react-native";

import type { CscaPhoto } from "@web/lib/portal/csca-overview";

const FILES: Readonly<Record<string, ImageSourcePropType>> = {
  "photos/campus-sichuan-240.webp": require("../../../../../src/content/csca/photos/campus-sichuan-240.webp"),
  "photos/campus-sichuan-720.webp": require("../../../../../src/content/csca/photos/campus-sichuan-720.webp"),
  "photos/campus-sichuan-1280.webp": require("../../../../../src/content/csca/photos/campus-sichuan-1280.webp"),
  "photos/campus-xiamen-720.webp": require("../../../../../src/content/csca/photos/campus-xiamen-720.webp"),
  "photos/campus-xiamen-1280.webp": require("../../../../../src/content/csca/photos/campus-xiamen-1280.webp"),
};

/** Файл кадра по плотности экрана: 720 для 2x, 1280 для 3x (как iPhone). */
export function photoSource(photo: CscaPhoto): ImageSourcePropType | null {
  const webp = photo.files.filter((f) => f.format === "webp").sort((a, b) => a.width - b.width);
  const want = PixelRatio.get() >= 3 ? 1280 : 720;
  const file = webp.find((f) => f.width >= want) ?? webp[webp.length - 1];
  return file ? FILES[file.path] ?? null : null;
}
