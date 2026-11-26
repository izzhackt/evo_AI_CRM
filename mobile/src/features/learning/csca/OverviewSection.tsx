// Вкладка «Об экзамене» (контракт §19; веб: components/portal/csca/Overview.tsx): что такое CSCA, календарь сессий,
// кому нужен, предметы и формат, стоимость, вопросы. Контент: один строгий JSON, общий с вебом и iPhone
// (src/content/csca/overview.json), разбор тем же парсером (@web/lib/portal/csca-overview). Дат в тексте нет: ответ
// «Когда проходит экзамен?» ведёт к блоку сессий этой же вкладки. Обзор статичен и виден без сети; календарь сессий
// приходит со своим запросом и подставляется в `sessions`.
import type { ReactNode } from "react";
import { View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";

import {
  CSCA_OVERVIEW,
  cscaGroupFacts,
  type CscaEvoStatus,
  type CscaOverviewGroup,
  type CscaOverviewSubject,
} from "@web/lib/portal/csca-overview";

import { CscaPhoto } from "@/features/learning/csca/CscaPhoto";
import { Disclosure } from "@/features/learning/csca/Disclosure";
import { cscaOnLabelSafe } from "@/features/learning/csca/format";
import { Chip } from "@/features/learning/ui";
import { useLang } from "@/i18n/LangProvider";
import { monoFont, sansFont } from "@/theme/fonts";
import { useTheme } from "@/theme/ThemeProvider";
import { MIN_TARGET } from "@/ui/CardParts";
import { Card } from "@/ui/Screen";
import { Text } from "@/ui/Text";

const EVO_TONE: Record<CscaEvoStatus, "ok" | "warn" | "neutral"> = { available: "ok", later: "warn", none: "neutral" };

/** Название предмета или группы: английское слово экзамена, рядом название на языке студента (если оно есть). */
function Names({ en, local, variant = "body" }: { en: string; local: string | null; variant?: "body" | "heading" }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", columnGap: 8 }}>
      <Text variant={variant} bold accessibilityLanguage="en">
        {en}
      </Text>
      {local ? (
        <Text variant={variant === "heading" ? "body" : "secondary"} tone="text2">
          {local}
        </Text>
      ) : null}
    </View>
  );
}

function FactGrid({ facts, testID }: { facts: readonly { key: string; label: string; value: string }[]; testID?: string }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 16, rowGap: 6 }} testID={testID}>
      {facts.map((fact) => (
        <View key={fact.key}>
          <Text variant="caption" tone="text2">
            {fact.label}
          </Text>
          <Text variant="secondary" bold>
            {fact.value}
          </Text>
        </View>
      ))}
    </View>
  );
}

function SubjectCard({ subject, own, group }: { subject: CscaOverviewSubject; own: readonly { key: string; label: string; value: string }[]; group: CscaOverviewGroup }) {
  const { lang } = useLang();
  const { tokens } = useTheme();
  const o = CSCA_OVERVIEW;
  const evo = `${o.subjects.columns.evo[lang]}: ${o.subjects.evoStatus[subject.evo][lang]}`;
  const local = subject.name ? subject.name[lang] : null;
  return (
    <View
      accessible
      accessibilityLabel={[subject.nameEn, local, ...own.map((fact) => `${fact.label}: ${fact.value}`), evo].filter(Boolean).join(". ")}
      style={{ gap: 4, paddingTop: 8, borderTopWidth: 1, borderTopColor: tokens.line }}
      testID={`subject-${group.key}-${subject.key}`}
    >
      <Names en={subject.nameEn} local={local} />
      {own.length > 0 ? <FactGrid facts={own} /> : null}
      <Chip tone={EVO_TONE[subject.evo]} label={evo} />
    </View>
  );
}

/** Группа предметов в узкой раскладке веба: общие факты один раз сеткой «подпись над значением», ниже предметы. */
function GroupCard({ group }: { group: CscaOverviewGroup }) {
  const { lang } = useLang();
  const o = CSCA_OVERVIEW;
  const facts = cscaGroupFacts(o, group, lang);
  return (
    <Card>
      <View accessibilityRole="header">
        <Names en={group.nameEn} local={group.name[lang]} variant="heading" />
      </View>
      {facts.shared.length > 0 ? <FactGrid facts={facts.shared} testID={`group-facts-${group.key}`} /> : null}
      {group.subjects.map((subject) => (
        <SubjectCard key={subject.key} subject={subject} own={facts.bySubject[subject.key] ?? []} group={group} />
      ))}
    </Card>
  );
}

/** «Нужен» закрашенный круг с галочкой, «не нужен» кольцо с чертой: смысл несёт слово, значок только подкрепляет. */
function VerdictIcon({ needed }: { needed: boolean }) {
  const { tokens } = useTheme();
  const color = needed ? tokens.text : tokens.text2;
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width={28} height={28} viewBox="0 0 28 28" fill="none">
        <Circle cx={14} cy={14} r={13} fill={needed ? color : "none"} stroke={color} strokeWidth={1.5} />
        {needed ? (
          <Path d="m8.5 14.5 3.6 3.5 7.4-8" stroke={tokens.surface} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <Path d="M9 14h10" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
        )}
      </Svg>
    </View>
  );
}

function Verdict({ needed, label, text, first }: { needed: boolean; label: string; text: string; first: boolean }) {
  const { tokens } = useTheme();
  return (
    <View style={{ gap: 4, paddingTop: first ? 4 : 16, paddingBottom: first ? 16 : 0, borderTopWidth: first ? 0 : 1, borderTopColor: tokens.line }} testID={needed ? "verdict-needed" : "verdict-not-needed"}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
        <VerdictIcon needed={needed} />
        <Text variant="body" bold style={{ flex: 1 }}>
          {label}
        </Text>
      </View>
      <Text variant="secondary" style={{ marginLeft: 42 }}>
        {text}
      </Text>
    </View>
  );
}

function Audience() {
  const { lang } = useLang();
  const o = CSCA_OVERVIEW;
  // Фото кампуса стоит перед текстом, как на веб в узком листе.
  return (
    <Card>
      <CscaPhoto photoKey={o.photos.audience} aspectRatio={16 / 9} rounded testID="overview-photo-audience" />
      <Text variant="title" accessibilityRole="header">
        {o.audience.title[lang]}
      </Text>
      <View>
        <Verdict needed label={o.audience.needed.label[lang]} text={o.audience.needed.text[lang]} first />
        <Verdict needed={false} label={o.audience.notNeeded.label[lang]} text={o.audience.notNeeded.text[lang]} first={false} />
      </View>
    </Card>
  );
}

function Subjects() {
  const { lang } = useLang();
  const o = CSCA_OVERVIEW;
  return (
    <View style={{ gap: 12 }}>
      <Text variant="title" accessibilityRole="header">
        {o.subjects.title[lang]}
      </Text>
      {o.subjects.groups.map((group) => (
        <GroupCard key={group.key} group={group} />
      ))}
    </View>
  );
}

function Fees() {
  const { lang } = useLang();
  const { tokens } = useTheme();
  const o = CSCA_OVERVIEW;
  return (
    <Card>
      <Text variant="title" accessibilityRole="header">
        {o.fees.title[lang]}
      </Text>
      <View>
        <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8, paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: tokens.line }}>
          <Text variant="caption" tone="text2" bold style={{ flex: 1 }}>
            {o.fees.columns.subjects[lang]}
          </Text>
          <Text variant="caption" tone="text2" bold>
            {o.fees.columns.fee[lang]}
          </Text>
        </View>
        {o.fees.rows.map((row) => (
          <View key={row.key} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: 8, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: tokens.line }} testID={`fee-${row.key}`}>
            <Text variant="secondary" style={{ flex: 1 }}>
              {row.label[lang]}
            </Text>
            <Text variant="body" style={{ fontFamily: monoFont("bold") }}>
              {row.fee}
            </Text>
          </View>
        ))}
      </View>
    </Card>
  );
}

/** Вопросы свёрнуты, как `<details>` на вебе; ответ «Когда проходит экзамен?» ведёт к блоку сессий. */
function Faq({ sessionsShown, onOpenSessions }: { sessionsShown: boolean; onOpenSessions: () => void }) {
  const { lang } = useLang();
  const { tokens } = useTheme();
  const o = CSCA_OVERVIEW;
  return (
    <Card>
      <Text variant="title" accessibilityRole="header">
        {o.faq.title[lang]}
      </Text>
      <View style={{ borderTopWidth: 1, borderTopColor: tokens.line }}>
        {o.faq.items.map((item) => (
          <View key={item.id} style={{ borderBottomWidth: 1, borderBottomColor: tokens.line }}>
            <Disclosure
              testID={`faq-${item.id}`}
              headerTestID={`faq-toggle-${item.id}`}
              minHeight={MIN_TARGET + 8}
              headerStyle={{ paddingVertical: 8 }}
              header={
                <Text variant="body" style={{ fontFamily: sansFont("medium") }}>
                  {item.question[lang]}
                </Text>
              }
            >
              <View style={{ gap: 8, paddingBottom: 12 }}>
                {item.link && !sessionsShown ? (
                  <Text variant="secondary">{item.link.withoutSessions[lang]}</Text>
                ) : (
                  item.answer.map((part, index) => (
                    <Text key={index} variant="secondary">
                      {part[lang]}
                    </Text>
                  ))
                )}
                {item.link && sessionsShown ? (
                  <FaqLink label={item.link.label[lang]} onPress={onOpenSessions} />
                ) : null}
              </View>
            </Disclosure>
          </View>
        ))}
      </View>
    </Card>
  );
}

function FaqLink({ label, onPress }: { label: string; onPress: () => void }) {
  const { tokens } = useTheme();
  return (
    <View style={{ alignSelf: "flex-start" }}>
      <Text
        variant="secondary"
        accessibilityRole="link"
        onPress={onPress}
        testID="faq-sessions"
        style={{ fontFamily: sansFont("medium"), textDecorationLine: "underline", textDecorationColor: tokens.controlEdge, paddingVertical: 12 }}
      >
        {label}
      </Text>
    </View>
  );
}

export function OverviewSection({ sessionsShown, sessions, onOpenSessions }: { sessionsShown: boolean; sessions: ReactNode; onOpenSessions: () => void }) {
  const { lang, t, format } = useLang();
  const c = t("csca");
  const o = CSCA_OVERVIEW;
  return (
    <View style={{ gap: 20 }} testID="csca-overview">
      <Card>
        <CscaPhoto photoKey={o.photos.hero} aspectRatio={16 / 10} rounded testID="overview-photo-hero" />
        <View style={{ gap: 12 }}>
          {o.intro.map((paragraph, index) => (
            <Text key={index} variant={index === 0 ? "heading" : "body"} style={index === 0 ? { fontFamily: sansFont("medium") } : undefined}>
              {paragraph[lang]}
            </Text>
          ))}
        </View>
      </Card>
      {sessions}
      <Audience />
      <Subjects />
      <Fees />
      <Faq sessionsShown={sessionsShown} onOpenSessions={onOpenSessions} />
      <Text variant="caption" tone="text2" testID="overview-checked">
        {format(c.overviewChecked, { date: cscaOnLabelSafe(o.confirmedOn, lang, true) })}
      </Text>
    </View>
  );
}
