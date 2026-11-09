import { useState } from "react";
import { View } from "react-native";

import { useLang } from "@/i18n/LangProvider";
import { useSession } from "@/session/SessionProvider";
import { TAB_BAR_CLEARANCE } from "@/shell/TabBar";
import { useTheme, type ThemeChoice } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { Segmented } from "@/ui/Segmented";
import { Card, Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";

// Профиль: язык, тема, выход. Остальное (мои данные, телефон, смена пароля S4,
// удаление аккаунта, согласие на ИИ, лицензии) идёт срезом M6.
// TODO(M6): мои данные, смена пароля, удаление аккаунта, согласие на ИИ, лицензии.
export default function ProfileScreen() {
  const { profile, m, lang, setLang, shell } = useLang();
  const { choice, setChoice } = useTheme();
  const { state, signOut } = useSession();
  const [busy, setBusy] = useState(false);
  const name = state.kind === "active" ? state.session.authority.displayName : "";

  return (
    <Screen topInset={false} bottomInset={TAB_BAR_CLEARANCE}>
      <Text variant="display" accessibilityRole="header" style={{ marginBottom: 16 }}>
        {profile.title}
      </Text>
      <View style={{ gap: 16 }}>
        {name ? (
          <Card>
            <Text variant="heading">{name}</Text>
            <Text variant="secondary" tone="text2">
              {shell.accountRole}
            </Text>
          </Card>
        ) : null}
        <Card>
          <Text variant="heading">{profile.languageHeading}</Text>
          <Segmented
            value={lang}
            onChange={setLang}
            testIDPrefix="profile-lang"
            options={[
              { value: "ru", label: profile.languageRu },
              { value: "ky", label: profile.languageKy },
            ]}
          />
          {/* TODO(M6): сохранять язык в БД (set_own_portal_language_v1), как на вебе. */}
        </Card>
        <Card>
          <Text variant="heading">{m("profile.theme")}</Text>
          <Segmented<ThemeChoice>
            value={choice}
            onChange={setChoice}
            testIDPrefix="theme"
            options={[
              { value: "light", label: m("profile.themeLight") },
              { value: "dark", label: m("profile.themeDark") },
              { value: "system", label: m("profile.themeSystem") },
            ]}
          />
        </Card>
        <Button
          label={busy ? m("profile.signingOut") : profile.logout}
          variant="ghost"
          busy={busy}
          testID="sign-out"
          onPress={() => {
            setBusy(true);
            void signOut().finally(() => setBusy(false));
          }}
        />
      </View>
    </Screen>
  );
}
