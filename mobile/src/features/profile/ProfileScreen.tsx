// Профиль (веб: portal/profile/page.tsx; iPhone: ProfileView): мои данные, язык, тема, согласие на ИИ,
// пароль, о приложении (политика, поддержка, лицензии), выход и удаление аккаунта.
// Телефон не меняется: на вебе такой строки нет (меняет куратор), поэтому и здесь только чтение имени и почты.
import { useQueryClient } from "@tanstack/react-query";
import Constants from "expo-constants";
import { useCallback, useState } from "react";
import { Pressable, View } from "react-native";

import { usePortalApi } from "@/api/PortalApi";
import { go, WRITE_EVO_ROUTE } from "@/features/portal/navigation";
import { openExternal, PRIVACY_URL, SUPPORT_URL } from "@/features/profile/external";
import { AiConsentRow } from "@/features/profile/AiConsent";
import { DeletionCard } from "@/features/profile/DeletionCard";
import { LicensesScreen } from "@/features/profile/LicensesScreen";
import { PasswordCard } from "@/features/profile/PasswordCard";
import { useOwnLogin, useOwnProfile, useSaveLanguage } from "@/features/profile/use-profile";
import { useLang } from "@/i18n/LangProvider";
import type { Lang } from "@/i18n";
import { useSession } from "@/session/SessionProvider";
import { useTheme, type ThemeChoice } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { CardHead, InlineAlert, LinkButton, MIN_TARGET } from "@/ui/CardParts";
import { Card, Screen } from "@/ui/Screen";
import { Segmented } from "@/ui/Segmented";
import { Text } from "@/ui/Text";

function Row({ label, value, testID }: { label: string; value: string; testID: string }) {
  return (
    <View accessible accessibilityLabel={`${label}: ${value}`} style={{ gap: 2 }} testID={testID}>
      <Text variant="caption" tone="text2">
        {label}
      </Text>
      <Text variant="body" selectable>
        {value}
      </Text>
    </View>
  );
}

function LinkRow({ label, onPress, testID }: { label: string; onPress: () => void; testID: string }) {
  const { tokens } = useTheme();
  return (
    <Pressable accessibilityRole="link" onPress={onPress} testID={testID} style={{ minHeight: MIN_TARGET, justifyContent: "center", borderTopWidth: 1, borderTopColor: tokens.line }}>
      <Text variant="body" tone="accent" bold>
        {label}
      </Text>
    </Pressable>
  );
}

export function ProfileScreen() {
  const { lang, setLang, profile: web, shell, m, format } = useLang();
  const { choice, setChoice } = useTheme();
  const { state, signOut } = useSession();
  const { userKey, tier } = usePortalApi();
  const client = useQueryClient();
  const profile = useOwnProfile();
  const login = useOwnLogin();
  const saveLanguage = useSaveLanguage();
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [licensesOpen, setLicensesOpen] = useState(false);
  const [linkFailed, setLinkFailed] = useState(false);
  const name = profile.data?.displayName ?? (state.kind === "active" ? state.session.authority.displayName : "");
  const version = Constants.expoConfig?.version ?? "";

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await client.refetchQueries({ queryKey: ["portal", userKey], type: "active" });
    } finally {
      setRefreshing(false);
    }
  }, [client, userKey]);

  const chooseLanguage = (next: Lang) => {
    if (next === lang || saveLanguage.isPending) return;
    // Как на вебе: язык меняется после ответа сервера, сбой оставляет прежний и говорит об этом.
    saveLanguage.mutate(next, { onSuccess: () => setLang(next) });
  };

  const open = async (url: string) => {
    setLinkFailed(false);
    if (!(await openExternal(url))) setLinkFailed(true);
  };

  return (
    <Screen topInset={false} tabBar onRefresh={() => void refresh()} refreshing={refreshing}>
      <Text variant="display" accessibilityRole="header" style={{ marginBottom: 16 }}>
        {web.title}
      </Text>
      <View style={{ gap: 16 }} testID="profile-screen">
        <Card>
          <CardHead title={m("profile.myData")} />
          {profile.isError && !profile.data ? (
            <InlineAlert message={m("error.load")} retryLabel={m("profile.retry")} onRetry={() => void profile.refetch()} testID="profile-error" />
          ) : null}
          {name ? <Row label={m("profile.nameLabel")} value={name} testID="profile-name" /> : null}
          {profile.data ? <Row label={m("profile.emailLabel")} value={profile.data.email} testID="profile-email" /> : null}
          {login.data ? <Row label={web.loginLabel} value={login.data} testID="profile-login-row" /> : null}
          {/* #1360: телефон и имя в кабинете не правятся (RPC для этого нет), меняет куратор: ссылка ведёт в чат. */}
          <Text variant="secondary" tone="text2" testID="profile-data-note">
            {tier === "assisted" ? web.dataNote : m("profile.dataNoteApproved")}
          </Text>
          {tier === "assisted" ? (
            <LinkButton label={web.dataWrite} onPress={() => go(WRITE_EVO_ROUTE)} testID="profile-write-evo" />
          ) : (
            <LinkButton label={m("profile.support")} onPress={() => void open(SUPPORT_URL)} testID="profile-data-support" />
          )}
          <Text variant="caption" tone="text2">
            {shell.accountRole}
          </Text>
        </Card>

        <Card>
          <CardHead title={web.languageHeading} />
          <Segmented<Lang>
            value={lang}
            onChange={chooseLanguage}
            testIDPrefix="profile-lang"
            options={[
              { value: "ru", label: web.languageRu },
              { value: "ky", label: web.languageKy },
            ]}
          />
          {saveLanguage.isError ? <InlineAlert message={web.languageError} testID="profile-lang-error" /> : null}
          <Text variant="caption" tone="text2">
            {m("profile.languageNote")}
          </Text>
        </Card>

        <Card>
          <CardHead title={m("profile.theme")} />
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

        <AiConsentRow />

        <PasswordCard />

        <Card>
          <CardHead title={m("profile.aboutHeading")} />
          <LinkRow label={m("profile.privacy")} onPress={() => void open(PRIVACY_URL)} testID="profile-privacy" />
          <LinkRow label={m("profile.support")} onPress={() => void open(SUPPORT_URL)} testID="profile-support" />
          <LinkRow label={m("profile.licenses")} onPress={() => setLicensesOpen(true)} testID="profile-licenses" />
          {linkFailed ? <InlineAlert message={m("profile.openFailed")} /> : null}
          {version ? (
            <Text variant="caption" tone="text2" testID="profile-version">
              {format(m("profile.version"), { version })}
            </Text>
          ) : null}
        </Card>

        <Button
          label={busy ? m("profile.signingOut") : web.logout}
          variant="ghost"
          busy={busy}
          testID="sign-out"
          onPress={() => {
            setBusy(true);
            void signOut().finally(() => setBusy(false));
          }}
        />

        <DeletionCard />
      </View>
      <LicensesScreen visible={licensesOpen} onClose={() => setLicensesOpen(false)} />
    </Screen>
  );
}
