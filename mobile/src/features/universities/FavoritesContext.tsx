// Избранное для карточек экрана: известно ли состояние (сердечко прячется, если чтение
// избранного не удалось - каталог от этого не падает, веб PORT-3b) и переключатель.
import { Alert } from "react-native";
import { useCallback, useEffect } from "react";

import { useLang } from "@/i18n/LangProvider";

import { useFavoriteIds, useToggleFavorite } from "./hooks";

export function useFavoriteState() {
  const { t } = useLang();
  const strings = t("universities");
  const ids = useFavoriteIds();
  const { toggle, failedId, clearFailed } = useToggleFavorite();
  useEffect(() => {
    if (failedId === null) return;
    // Откат уже сделан; одно предупреждение, как в iPhone (toggleFailed).
    Alert.alert(strings.favoriteError);
    clearFailed();
  }, [failedId, clearFailed, strings.favoriteError]);
  const set = ids.data === undefined ? null : new Set(ids.data);
  // Одна и та же функция между отрисовками: карточки каталога (`UniversityTileView`) сравнивают её и не перерисовываются зря.
  const toggleFavorite = useCallback((id: string, next: boolean) => void toggle(id, next), [toggle]);
  return {
    isFavored: (id: string): boolean | null => (set === null ? null : set.has(id)),
    toggle: toggleFavorite,
  };
}
