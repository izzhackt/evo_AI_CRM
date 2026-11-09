// «Об экзамене» (контракт §19): что такое CSCA, кому нужен, предметы и формат, стоимость, вопросы,
// фото кампуса с автором и лицензией по кнопке «©». Контент: один строгий JSON, общий с вебом и
// iPhone (src/content/csca/overview.json), разбор тем же парсером (@web/lib/portal/csca-overview).
// Дат в тексте нет: ответ «Когда проходит экзамен?» ведёт к блоку сессий.
import { router } from "expo-router";
import { useState } from "react";
import { Image, Linking, Pressable, View } from "react-native";

import {
  CSCA_OVERVIEW,
  CSCA_OVERVIEW_PHOTOS,
  cscaGroupFacts,
  type CscaEvoStatus,
  type CscaOverviewGroup,
} from "@web/lib/portal/csca-overview";

import { cscaOnLabelSafe } from "@/features/learning/csca/format";
import { photoSource } from "@/features/learning/csca/overview-photos";
import { useLang } from "@/i18n/LangProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { LinkButton } from "@/ui/CardParts";
import { Card } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { Chip } from "@/features/learning/ui";

function Photo({ photoKey }: { photoKey: string }) {
  const { lang, m, format } = useLang();
  const { tokens } = useTheme();
  const [credit, setCredit] = useState(false);
  const photo = CSCA_OVERVIEW_PHOTOS.find((p) => p.key === photoKey);
  const source = photo ? photoSource(photo) : null;
  if (!photo || !source) return null;
  return (
    <View style={{ gap: 4 }}>
      <View style={{ borderRadius: tokens.radiusCard, overflow: "hidden", backgroundColor: tokens.skeleton }}>
        <Image source={source} accessibilityLabel={photo.alt[lang]} resizeMode="cover" style={{ width: "100%", height: 200 }} testID={`overview-photo-${photoKey}`} />
        <Pressable accessibilityRole="button" accessibilityLabel={format(m("learn.photoCredit"), { author: photo.author })} onPress={() => setCredit((v) => !v)} hitSlop={8} style={{ position: "absolute", right: 8, bottom: 8, minWidth: 28, height: 28, borderRadius: 14, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center" }}>
          <Text variant="caption" tone="onAccent" bold>
            ©
          </Text>
        </Pressable>
      </View>
      {credit ? (
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <Text variant="caption" tone="text2">
            {format(m("learn.photoCredit"), { author: photo.author })} · {photo.licence}
          </Text>
          <LinkButton label={photo.sourceName} onPress={() => void Linking.openURL(photo.sourceUrl).catch(() => undefined)} />
        </View>
      ) : null}
    </View>
  );
}

const EVO_TONE: Record<CscaEvoStatus, "ok" | "warn" | "neutral"> = { available: "ok", later: "warn", none: "neutral" };

function GroupCard({ group }: { group: CscaOverviewGroup }) {
  const { lang } = useLang();
  const { tokens } = useTheme();
  const o = CSCA_OVERVIEW;
  const facts = cscaGroupFacts(o, group, lang);
  return (
    <Card>
      <Text variant="heading" accessibilityRole="header">
        {group.name[lang]}
      </Text>
      {facts.shared.length > 0 ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 16 }} testID={`group-facts-${group.key}`}>
          {facts.shared.map((f) => (
            <View key={f.key}>
              <Text variant="caption" tone="text2">
                {f.label}
              </Text>
              <Text variant="secondary" bold>
                {f.value}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
      {group.subjects.map((subject) => (
        <View key={subject.key} style={{ gap: 4, paddingTop: 8, borderTopWidth: 1, borderTopColor: tokens.line }} accessible accessibilityLabel={[(subject.name?.[lang] ?? subject.nameEn), ...facts.bySubject[subject.key].map((f) => `${f.label}: ${f.value}`), `${o.subjects.columns.evo[lang]}: ${o.subjects.evoStatus[subject.evo][lang]}`].join(". ")}>
          <Text variant="body" bold>
            {subject.name?.[lang] ?? subject.nameEn}
          </Text>
          {subject.name ? (
            <Text variant="caption" tone="text2">
              {subject.nameEn}
            </Text>
          ) : null}
          {facts.bySubject[subject.key].length > 0 ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 16 }}>
              {facts.bySubject[subject.key].map((f) => (
                <View key={f.key}>
                  <Text variant="caption" tone="text2">
                    {f.label}
                  </Text>
                  <Text variant="secondary" bold>
                    {f.value}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
          <Chip tone={EVO_TONE[subject.evo]} label={`${o.subjects.columns.evo[lang]}: ${o.subjects.evoStatus[subject.evo][lang]}`} />
        </View>
      ))}
    </Card>
  );
}

export function OverviewSection({ hasSessions }: { hasSessions: boolean }) {
  const { lang, t, format } = useLang();
  const { tokens } = useTheme();
  const c = t("csca");
  const o = CSCA_OVERVIEW;
  return (
    <View style={{ gap: 16 }} testID="csca-overview">
      <Photo photoKey={o.photos.hero} />
      <Text variant="body" bold>
        {o.summary[lang]}
      </Text>
      {o.intro.map((p, i) => (
        <Text key={i} variant="body">
          {p[lang]}
        </Text>
      ))}
      <Card>
        <Text variant="heading" accessibilityRole="header">
          {o.audience.title[lang]}
        </Text>
        <View style={{ gap: 2 }}>
          <Text variant="secondary" bold>
            {o.audience.needed.label[lang]}
          </Text>
          <Text variant="secondary">{o.audience.needed.text[lang]}</Text>
        </View>
        <View style={{ gap: 2 }}>
          <Text variant="secondary" bold>
            {o.audience.notNeeded.label[lang]}
          </Text>
          <Text variant="secondary">{o.audience.notNeeded.text[lang]}</Text>
        </View>
      </Card>
      <Photo photoKey={o.photos.audience} />
      <Text variant="heading" accessibilityRole="header">
        {o.subjects.title[lang]}
      </Text>
      {o.subjects.groups.map((g) => (
        <GroupCard key={g.key} group={g} />
      ))}
      <Card>
        <Text variant="heading" accessibilityRole="header">
          {o.fees.title[lang]}
        </Text>
        {o.fees.rows.map((row) => (
          <View key={row.key} style={{ flexDirection: "row", justifyContent: "space-between", gap: 8, paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: tokens.line }}>
            <Text variant="secondary" style={{ flex: 1 }}>
              {row.label[lang]}
            </Text>
            <Text variant="secondary" bold>
              {row.fee} {o.fees.currency}
            </Text>
          </View>
        ))}
      </Card>
      <Text variant="heading" accessibilityRole="header">
        {o.faq.title[lang]}
      </Text>
      {o.faq.items.map((item) => (
        <Card key={item.id}>
          <Text variant="body" bold>
            {item.question[lang]}
          </Text>
          {item.link && !hasSessions ? (
            <Text variant="secondary">{item.link.withoutSessions[lang]}</Text>
          ) : (
            item.answer.map((p, i) => (
              <Text key={i} variant="secondary">
                {p[lang]}
              </Text>
            ))
          )}
          {item.link && hasSessions ? <Button variant="ghost" label={item.link.label[lang]} onPress={() => router.navigate("/csca/sessions")} testID="faq-sessions" /> : null}
        </Card>
      ))}
      <Text variant="caption" tone="text2">
        {format(c.overviewChecked, { date: cscaOnLabelSafe(o.confirmedOn, lang, true) })}
      </Text>
    </View>
  );
}
