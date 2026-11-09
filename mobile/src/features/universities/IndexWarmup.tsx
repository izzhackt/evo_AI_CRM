import { useUniversityIndex } from "./hooks";

/** Загрузка индекса каталога в начале сессии (iPhone: `.task(id: organizationId)`), а не при первом заходе в раздел. */
export function UniversityIndexWarmup() {
  useUniversityIndex();
  return null;
}
