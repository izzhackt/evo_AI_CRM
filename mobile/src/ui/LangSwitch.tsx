import { View } from "react-native";

import { useLang } from "@/i18n/LangProvider";
import { Segmented } from "@/ui/Segmented";

/** RU | KY (портал говорит только на этих двух языках). */
export function LangSwitch() {
  const { lang, setLang } = useLang();
  return (
    <View style={{ width: 140 }}>
      <Segmented value={lang} onChange={setLang} testIDPrefix="lang" options={[{ value: "ru", label: "RU" }, { value: "ky", label: "KY" }]} />
    </View>
  );
}
