// Переходы к «Подбору с Эви» и обратно так, чтобы два экрана Эви никогда не стояли в стеке друг под другом.
// Что делает expo-router 58 (проверено по `build/react-navigation/routers/StackRouter.js` и в проверке с настоящим стеком,
// `__tests__/evi-navigation.test.tsx`): `router.navigate(a)` кладёт новый экран, если `a` - не тот, на котором стоишь, и
// не возвращается к такому же экрану в стеке; `router.dismissTo(a)` возвращается к экрану `a`, если он уже в стеке, иначе
// заменяет текущий экран на `a`. Поэтому «К каталогу» из Эви - `dismissTo` (а не `navigate`, который клал второй каталог поверх
// Эви), а вход в Эви - `dismissTo`, когда Эви уже в стеке, и `navigate` в остальных случаях (из каталога Эви кладётся сверху).
import { router, useNavigation } from "expo-router";

const EVI_ROUTE = "/professions/evi";
const CATALOG_ROUTE = "/professions";
/** Имя экрана Эви в стеке «Профессий» (файл `professions/evi.tsx`). */
const EVI_SCREEN = "evi";

/** Открыть «Подбор с Эви» с экрана «Профессий»: уже открытый (под другими экранами) переиспользуется, второй не кладётся. */
export function useOpenEvi(): () => void {
  const navigation = useNavigation();
  return () => {
    const stacked = navigation.getState()?.routes.some((route) => route.name === EVI_SCREEN) === true;
    if (stacked) router.dismissTo(EVI_ROUTE);
    else router.navigate(EVI_ROUTE);
  };
}

/** «Открыть каталог» из Эви и уход, когда согласие отозвано: к каталогу, который уже в стеке, а не новый поверх Эви. */
export function leaveEviForCatalog(): void {
  router.dismissTo(CATALOG_ROUTE);
}
