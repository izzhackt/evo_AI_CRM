// Профиль (веб: portal/profile/page.tsx; iPhone: ProfileView): карточка студента сверху (инициалы, имя, страна и этап,
// «Выйти», «Личные результаты тестов»), «Ваша анкета», мои данные, язык, тема, пароль, одна секция «Конфиденциальность»
// (политика, поддержка, согласие на ИИ одной строкой, удаление аккаунта; решение владельца 14.11.2026: без объяснений
// о данных) и «О приложении» (лицензии, версия). «Выйти» наверху, как на вебе.
// Телефон не меняется: на вебе такой строки нет (меняет куратор), поэтому и здесь только чтение имени и почты.
import { useQueryClient } from "@tanstack/react-query";
import Constants from "expo-constants";
import { useCallback, useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import { accountInitials } from "@web/components/portal/initials";
import { isStudyCountryCode, studyCountryName } from "@web/lib/study-countries";

import { usePortalApi } from "@/api/PortalApi";
import { useCountryChoice, useOverview } from "@/api/queries";
import { stageLabel } from "@/domain/presentation";
import { ConsultationCard } from "@/features/consultation/ConsultationCard";
import { go, WRITE_EVO_ROUTE } from "@/features/portal/navigation";
import { openExternal, PRIVACY_URL, SUPPORT_URL } from "@/features/profile/external";
import { AiConsentRow } from "@/features/profile/AiConsent";
import { DeletionPanel } from "@/features/profile/DeletionPanel";
import { LicensesScreen } from "@/features/profile/LicensesScreen";
import { PasswordCard } from "@/features/profile/PasswordCard";
import { useOwnApplication, useOwnLogin, useOwnProfile, useSaveLanguage } from "@/features/profile/use-profile";
import { applicationAnswers } from "@/features/registration/answers";
import { useLang } from "@/i18n/LangProvider";
import type { Lang } from "@/i18n";
import { useSession } from "@/session/SessionProvider";
import { useTheme, type ThemeChoice } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { CardHead, CardSkeleton, InlineAlert, LinkButton, MIN_TARGET } from "@/ui/CardParts";
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

/** Короткая метка под именем: страна поступления, этап дела (веб: `pt-chip`). */
function Chip({ label }: { label: string }) {
  const { tokens } = useTheme();
  return (
    <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: tokens.radiusChip, backgroundColor: tokens.accentSoft }}>
      <Text variant="caption" tone="accent" bold>
        {label}
      </Text>
    </View>
  );
}

/**
 * Имя занимает не больше двух строк, дальше шрифт ужимается (не мельче 60%). Это смягчение, а не гарантия: RN считает вторую строку с
 * посимвольным переносом уместившейся и может шрифт не ужать. Целым слово держит ширина колонки имени (см. `ProfileHero`).
 */
const NAME_LINES = 2;
const NAME_MIN_SCALE = 0.6;

/**
 * Карточка студента наверху (веб: ProfileHero.tsx): круг с инициалами вместо фото (поля фото у студента нет), имя, метки
 * страны и этапа, «Выйти» и под чертой строка «Личные результаты тестов». Метки читаются отдельно от профиля: сбой чтения -
 * без метки, как на вебе.
 *
 * На телефоне «Выйти» стоит отдельной строкой под именем, а не справа от него (веб, `.pt-profile-hero-action`: «Телефон: «Выйти»
 * под именем; от 640 px - справа в той же строке»; приложение только на телефоне). Справа кнопка отнимала у имени около 80 pt из
 * 270, и «Сопровождаемый» ломалось посреди слова (QA#2, D6). У имени своя колонка (`flex: 1`, `minWidth: 0`): ничто рядом её не
 * сужает; на крупном шрифте имя занимает до двух рядов и ужимается.
 *
 * Запас по замеру независимого рецензента (Golos SemiBold 20 pt): «Сопровождаемый» - 179 pt при масштабе шрифта 1, 215 при 1,2 и 251 на
 * пределе 1,4 (`maxFontSizeMultiplier` у `heading`); колонка имени - ширина экрана минус 134: 268 pt на 402, 259 на 393, 241 на 375,
 * 226 на 360, 186 на 320. Значит, при обычном шрифте слово помещается на любой ширине от 320 pt, а на пределе 1,4 - от 385 pt (402 и 393
 * подходят); на 375, 360 и 320 pt при самом крупном шрифте оно ещё может порваться: `numberOfLines` и `adjustsFontSizeToFit` целого слова
 * не гарантируют. Эту границу проверяет только устройство.
 */
function ProfileHero({ name, chips, busy, onSignOut, onTests, signOutLabel, testsLabel }: { name: string; chips: readonly string[]; busy: boolean; onSignOut: () => void; onTests: () => void; signOutLabel: string; testsLabel: string }) {
  const { tokens } = useTheme();
  return (
    <Card>
      <View style={{ gap: 12 }} testID="profile-hero">
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }} testID="profile-hero-main">
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: tokens.accentSoft, alignItems: "center", justifyContent: "center" }}
            testID="profile-avatar"
          >
            <Text variant="heading" tone="accent" bold>
              {accountInitials(name)}
            </Text>
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: 6 }} testID="profile-hero-identity">
            <Text variant="heading" accessibilityRole="header" numberOfLines={NAME_LINES} adjustsFontSizeToFit minimumFontScale={NAME_MIN_SCALE} testID="profile-hero-name">
              {name}
            </Text>
            {chips.length > 0 ? (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }} testID="profile-chips">
                {chips.map((chip) => (
                  <Chip key={chip} label={chip} />
                ))}
              </View>
            ) : null}
          </View>
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }} testID="profile-hero-actions">
          <Button label={signOutLabel} variant="ghost" busy={busy} onPress={onSignOut} testID="sign-out" />
        </View>
      </View>
      <LinkRow label={testsLabel} onPress={onTests} testID="profile-tests-link" />
    </Card>
  );
}

/** Блок секции под линией, как у строк-ссылок: согласие на ИИ и удаление аккаунта. */
function Divided({ children }: { children: ReactNode }) {
  const { tokens } = useTheme();
  return <View style={{ borderTopWidth: 1, borderTopColor: tokens.line, paddingTop: 12 }}>{children}</View>;
}

export function ProfileScreen() {
  const { lang, setLang, profile: web, shell, m, format, t } = useLang();
  const { choice, setChoice } = useTheme();
  const { state, signOut } = useSession();
  const { userKey, tier } = usePortalApi();
  const client = useQueryClient();
  const profile = useOwnProfile();
  const login = useOwnLogin();
  const application = useOwnApplication();
  const countryChoice = useCountryChoice();
  const overview = useOverview();
  const saveLanguage = useSaveLanguage();
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [licensesOpen, setLicensesOpen] = useState(false);
  const [linkFailed, setLinkFailed] = useState(false);
  const name = profile.data?.displayName ?? (state.kind === "active" ? state.session.authority.displayName : "");
  const version = Constants.expoConfig?.version ?? "";
  const admission = t("admission");
  const apply = t("apply") as unknown as Readonly<Record<string, string>>;
  // Метки как на вебе: страна поступления (если выбрана) и этап дела (только у клиента на сопровождении).
  const country = countryChoice.data?.country ?? null;
  const stage = tier === "assisted" && overview.data ? stageLabel(overview.data.operationalStage, admission) : null;
  const chips = [country !== null && isStudyCountryCode(country) ? studyCountryName(country, lang) : null, stage ? `${admission.stageTerm}: ${stage}` : null].filter(
    (chip): chip is string => chip !== null,
  );

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
        <ProfileHero
          name={name}
          chips={chips}
          busy={busy}
          signOutLabel={busy ? m("profile.signingOut") : web.logout}
          testsLabel={web.testsLink}
          onTests={() => go("/tests")}
          onSignOut={() => {
            setBusy(true);
            void signOut().finally(() => setBusy(false));
          }}
        />

        {application.isPending ? (
          <Card>
            <CardSkeleton label={`${apply.answersHeading}. ${m("state.loading")}`} lines={3} testID="profile-application-loading" />
          </Card>
        ) : application.isError ? (
          <Card>
            <CardHead title={apply.answersHeading} />
            <InlineAlert message={web.applicationUnavailable} retryLabel={m("profile.retry")} onRetry={() => void application.refetch()} testID="profile-application-error" />
          </Card>
        ) : application.data ? (
          <Card>
            <CardHead title={apply.answersHeading} />
            <View style={{ gap: 12 }} testID="profile-application">
              {applicationAnswers(application.data.questionnaire, apply, lang).map((row) => (
                <View key={row.label} accessible accessibilityLabel={`${row.label}: ${row.value}`} style={{ gap: 2 }}>
                  <Text variant="caption" tone="text2">
                    {row.label}
                  </Text>
                  <Text variant="body" selectable>
                    {row.value}
                  </Text>
                </View>
              ))}
            </View>
          </Card>
        ) : null}

        <Card>
          <CardHead title={m("profile.myData")} />
          {profile.isError && !profile.data ? (
            <InlineAlert message={m("error.load")} retryLabel={m("profile.retry")} onRetry={() => void profile.refetch()} testID="profile-error" />
          ) : null}
          {name ? <Row label={m("profile.nameLabel")} value={name} testID="profile-name" /> : null}
          {profile.data ? <Row label={m("profile.emailLabel")} value={profile.data.email} testID="profile-email" /> : null}
          {login.data ? <Row label={web.loginLabel} value={login.data} testID="profile-login-row" /> : null}
          {/* #1360: телефон и имя в кабинете не правятся (RPC для этого нет), меняет куратор: у клиента на сопровождении ссылка
              ведёт в чат, у самостоятельного студента на запись на консультацию ниже (как на вебе). */}
          <Text variant="secondary" tone="text2" testID="profile-data-note">
            {tier === "assisted" ? web.dataNote : web.dataNoteApproved}
          </Text>
          {tier === "assisted" ? <LinkButton label={web.dataWrite} onPress={() => go(WRITE_EVO_ROUTE)} testID="profile-write-evo" /> : null}
          <Text variant="caption" tone="text2">
            {shell.accountRole}
          </Text>
        </Card>

        <ConsultationCard />

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

        <PasswordCard />

        <Card>
          <CardHead title={web.privacyHeading} />
          <LinkRow label={web.privacyPolicy} onPress={() => void open(PRIVACY_URL)} testID="profile-privacy" />
          <LinkRow label={web.supportLink} onPress={() => void open(SUPPORT_URL)} testID="profile-support" />
          {linkFailed ? <InlineAlert message={m("profile.openFailed")} /> : null}
          <Divided>
            <AiConsentRow />
          </Divided>
          <Divided>
            <DeletionPanel />
          </Divided>
        </Card>

        <Card>
          <CardHead title={m("profile.aboutHeading")} />
          <LinkRow label={m("profile.licenses")} onPress={() => setLicensesOpen(true)} testID="profile-licenses" />
          {version ? (
            <Text variant="caption" tone="text2" testID="profile-version">
              {format(m("profile.version"), { version })}
            </Text>
          ) : null}
        </Card>
      </View>
      <LicensesScreen visible={licensesOpen} onClose={() => setLicensesOpen(false)} />
    </Screen>
  );
}
