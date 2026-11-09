// Неверный адрес каталога (веб: 404): честное сообщение и путь к списку стран.
import { SearchX } from "lucide-react-native";
import { View } from "react-native";

import { useLang } from "@/i18n/LangProvider";
import { Button } from "@/ui/Button";
import { EmptyBlock } from "@/ui/CardParts";
import { Screen } from "@/ui/Screen";

import { open } from "./parts";

export function NotFoundBlock({ message }: { message?: string }) {
  const { t } = useLang();
  const strings = t("universities");
  return (
    <Screen topInset={false} tabBar>
      <View testID="catalog-not-found">
        <EmptyBlock icon={SearchX} title={message ?? strings.countryEmptyTitle} action={<Button variant="ghost" label={strings.allCountries} onPress={() => open("/universities")} />} />
      </View>
    </Screen>
  );
}
