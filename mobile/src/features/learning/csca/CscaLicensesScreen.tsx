// Лицензии и источники раздела «Учёба»: MathJax (Apache-2.0), шрифты, фото, контент.
import { Linking } from "react-native";

import { CSCA_OVERVIEW_PHOTOS } from "@web/lib/portal/csca-overview";

import { StackPage, SubHeader, useBack } from "@/features/learning/ui";
import { useLang } from "@/i18n/LangProvider";
import { LinkButton } from "@/ui/CardParts";
import { Card } from "@/ui/Screen";
import { Text } from "@/ui/Text";

export function CscaLicensesScreen() {
  const { m, t } = useLang();
  const back = useBack("/csca");
  const c = t("csca");
  const lines = ["learn.licenseMathjax", "learn.licenseTasks", "learn.licensePhotos", "learn.licenseFonts", "learn.licenseOnet", "learn.licenseTests"] as const;
  return (
    <StackPage header={<SubHeader title={m("learn.licensesTitle")} onBack={back} backLabel={c.backToHome} testID="licenses-title" />} testID="licenses-screen">
      <Card>
        {lines.map((key) => (
          <Text key={key} variant="secondary">
            {m(key)}
          </Text>
        ))}
      </Card>
      <Card>
        {CSCA_OVERVIEW_PHOTOS.map((p) => (
          <LinkButton key={p.key} label={`${p.author}: ${p.licence}`} onPress={() => void Linking.openURL(p.sourceUrl).catch(() => undefined)} />
        ))}
      </Card>
    </StackPage>
  );
}
