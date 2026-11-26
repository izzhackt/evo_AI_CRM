// Неверный адрес каталога (веб: 404 портала): общая «Страница не найдена» и путь к списку стран. Прежде здесь стояло «В этой
// стране пока нет опубликованных университетов»: избранный вуз, который сняли с публикации, открывал страницу, будто пуста
// страна (G42). Пустая страна - другое состояние, оно показывается на экране страны.
import { SearchX } from "lucide-react-native";
import { View } from "react-native";

import { useLang } from "@/i18n/LangProvider";
import { Button } from "@/ui/Button";
import { EmptyBlock } from "@/ui/CardParts";
import { Screen } from "@/ui/Screen";

import { ALL_COUNTRIES_ROUTE, open } from "./parts";

/**
 * `embedded` - блок уже стоит внутри страницы (`Screen`) каталога: своей прокрутки не создаёт. Вложенный `Screen` внутри `Screen`
 * давал двойные поля и сжатую высоту (U12 аудита); сам по себе, на неверном адресе, блок занимает экран целиком.
 */
export function NotFoundBlock({ embedded = false }: { embedded?: boolean }) {
  const { t, m } = useLang();
  const strings = t("universities");
  const block = (
    <View testID="catalog-not-found">
      <EmptyBlock icon={SearchX} title={m("uni.notFoundTitle")} body={m("uni.notFoundBody")} action={<Button variant="ghost" label={strings.allCountries} onPress={() => open(ALL_COUNTRIES_ROUTE)} />} />
    </View>
  );
  if (embedded) return block;
  return (
    <Screen topInset={false} tabBar>
      {block}
    </Screen>
  );
}
