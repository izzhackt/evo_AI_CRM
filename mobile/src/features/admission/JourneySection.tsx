// «Путь поступления» на «Поступлении» (CountryTimeline.tsx, веб #1412): выбранная
// страна, строка «Сейчас: …», полоса шагов, раскрываемые шаги с пунктами и ссылками,
// «Важно знать». Тексты шагов приходят из src/content/timelines/*.json через общий разбор
// веба (набор bundled, работает без сети); здесь только вид.
import { Calendar, Check, ChevronDown, ExternalLink, Info } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import type { CountryChoiceSource } from "@web/lib/portal/country-choice";
import type { CountryTimelineView, TimelineStepProgress, TimelineViewStep } from "@web/lib/portal/country-timeline";

import { usePortalApi } from "@/api/PortalApi";
import { useFolded, useOpenSteps } from "@/features/admission/useOpenSteps";
import { CountryPicker } from "@/features/portal/CountryChoiceCard";
import { JourneyMeter } from "@/features/portal/JourneyMeter";
import { go, openLink } from "@/features/portal/navigation";
import { useLang } from "@/i18n/LangProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { MIN_TARGET, InlineAlert } from "@/ui/CardParts";
import { Card } from "@/ui/Screen";
import { Text } from "@/ui/Text";

const NODE = 32;

function StepPanel({ step }: { step: TimelineViewStep }) {
  const { t } = useLang();
  const { tokens } = useTheme();
  const timeline = t("timeline");
  return (
    <View style={{ gap: 12, paddingTop: 8 }}>
      {step.note ? (
        <Text variant="secondary" tone="text2">
          {step.note}
        </Text>
      ) : null}
      {step.items.length > 0 ? (
        <View style={{ gap: 8 }}>
          <Text variant="caption" tone="text2" bold accessibilityRole="header">
            {timeline.checklist}
          </Text>
          {step.items.map((item) => (
            <View key={item.id} testID={`item-${item.id}`} style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
              <View
                style={{ borderWidth: 1, borderColor: item.who === "student" ? tokens.controlEdge : tokens.line, borderRadius: tokens.radiusChip, paddingHorizontal: 8, paddingVertical: 2, backgroundColor: tokens.surface }}
              >
                <Text variant="caption" bold={item.who === "student"} tone={item.who === "student" ? "text" : "text2"}>
                  {item.whoLabel}
                </Text>
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                {item.appliesTo ? (
                  <Text variant="caption" tone="text2">
                    {item.appliesTo}
                  </Text>
                ) : null}
                <Text variant="secondary">{item.text}</Text>
                {item.note ? (
                  <Text variant="caption" tone="text2">
                    {item.note}
                  </Text>
                ) : null}
              </View>
            </View>
          ))}
        </View>
      ) : null}
      {step.links.map((link) => (
        <Pressable
          key={link.id}
          accessibilityRole="link"
          accessibilityLabel={link.external ? `${link.label} (${timeline.external})` : link.label}
          accessibilityHint={link.external ? timeline.external : undefined}
          onPress={() => openLink(link.href)}
          style={{ minHeight: MIN_TARGET, flexDirection: "row", alignItems: "center", gap: 6 }}
          testID={`link-${link.id}`}
        >
          <Text variant="secondary" tone="accent" bold style={{ flexShrink: 1 }}>
            {link.label}
          </Text>
          {link.external ? <ExternalLink size={16} strokeWidth={1.75} color={tokens.accent} /> : null}
        </Pressable>
      ))}
      <View style={{ gap: 4, padding: 12, borderRadius: tokens.radiusItem, backgroundColor: tokens.bg }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Check size={16} strokeWidth={1.75} color={tokens.ok} />
          <Text variant="caption" bold accessibilityRole="header">
            {timeline.doneWhen}
          </Text>
        </View>
        <Text variant="secondary">{step.doneWhen}</Text>
      </View>
    </View>
  );
}

export function JourneySection({
  view,
  progress,
  source,
  readFailed,
  assisted,
  initiallyUnfolded = false,
  unfoldStamp = "",
}: {
  view: CountryTimelineView;
  progress: Readonly<Record<string, TimelineStepProgress>> | null;
  source: CountryChoiceSource | null;
  readFailed: boolean;
  assisted: boolean;
  /** Переход «Весь путь» с «Главной»: путь раскрыт. */
  initiallyUnfolded?: boolean;
  /** Метка запроса «раскрыть» (`at` ссылки): новая метка раскрывает путь снова, даже если студент его свернул. */
  unfoldStamp?: string;
}) {
  const { t, m, format } = useLang();
  const { userKey } = usePortalApi();
  const { tokens } = useTheme();
  const timeline = t("timeline");
  const total = view.steps.length;
  const progressOf = (id: string): TimelineStepProgress | null => progress?.[id] ?? null;
  const doneSteps = view.steps.filter((step) => progressOf(step.id) === "done");
  const currentStep = view.steps.find((step) => progressOf(step.id) === "current") ?? null;

  const [pickerOpen, setPickerOpen] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const { open, toggle } = useOpenSteps(view, userKey);
  // Без выбора студента путь с текущим шагом свёрнут: на виду строка «Сейчас: …»; без дела раскрыт.
  const { folded, setFolded } = useFolded(currentStep !== null, userKey);
  useEffect(() => {
    if (initiallyUnfolded) setFolded(false);
  }, [initiallyUnfolded, unfoldStamp, setFolded]);

  const title = view.countryName ? format(timeline.headingCountry, { country: view.countryName }) : timeline.heading;
  const sourceNote = source === "application" ? timeline.sourceApplication : source === "case" ? timeline.sourceCase : null;

  const foldButton = (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: !folded }}
      accessibilityLabel={folded ? timeline.showSteps : timeline.hideSteps}
      onPress={() => setFolded(!folded)}
      testID="journey-fold"
      style={{ minHeight: MIN_TARGET, flexDirection: "row", alignItems: "center", gap: 4 }}
    >
      <Text variant="secondary" tone="accent" bold>
        {folded ? timeline.showSteps : timeline.hideSteps}
      </Text>
      <ChevronDown size={18} strokeWidth={1.75} color={tokens.accent} style={{ transform: [{ rotate: folded ? "0deg" : "180deg" }] }} />
    </Pressable>
  );

  const jumpToCurrent = () => {
    if (!currentStep) return;
    if (folded) setFolded(false);
    if (!open.has(currentStep.id)) toggle(currentStep.id);
  };

  return (
    <Card>
      <View style={{ gap: 4 }}>
        <Text variant="heading" accessibilityRole="header">
          {title}
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Calendar size={16} strokeWidth={1.75} color={tokens.text2} />
          <Text variant="secondary" style={{ flexShrink: 1 }}>
            {view.intake.label}
          </Text>
        </View>
        {view.intake.note ? (
          <Text variant="caption" tone="text2">
            {view.intake.note}
          </Text>
        ) : null}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: pickerOpen }}
        onPress={() => setPickerOpen((value) => !value)}
        testID="change-country"
        style={({ pressed }) => ({
          minHeight: MIN_TARGET,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: tokens.radiusControl,
          borderWidth: 1,
          borderColor: tokens.line,
          backgroundColor: tokens.surface,
          transform: [{ scale: pressed ? tokens.pressScale : 1 }],
        })}
      >
        <Text variant="body" bold>
          {timeline.changeCountry}
        </Text>
      </Pressable>
      {sourceNote ? (
        <Text variant="caption" tone="text2">
          {sourceNote}
        </Text>
      ) : null}
      {readFailed ? <InlineAlert message={m("error.load")} /> : null}
      {pickerOpen ? <CountryPicker current={view.choice} source={source} lead={timeline.changeLead} onDone={() => setPickerOpen(false)} /> : null}

      {currentStep ? (
        <View accessibilityRole="summary" accessibilityLabel={timeline.whereNow} style={{ gap: 8 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${timeline.nowLabel} ${currentStep.title}. ${format(timeline.stepOf, { n: String(currentStep.order), total: String(total) })}`}
              onPress={jumpToCurrent}
              testID="journey-now"
              style={{ flex: 1, minHeight: MIN_TARGET, justifyContent: "center" }}
            >
              <Text variant="secondary">
                <Text variant="secondary" tone="text2">
                  {timeline.nowLabel}{" "}
                </Text>
                <Text variant="secondary" bold>
                  {currentStep.title}
                </Text>
              </Text>
            </Pressable>
            {foldButton}
          </View>
          <JourneyMeter steps={view.steps} progress={progress} />
        </View>
      ) : (
        <View style={{ alignItems: "flex-end" }}>{foldButton}</View>
      )}

      {folded ? null : (
        <View style={{ gap: 4 }} testID="journey-body">
          {doneSteps.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: showDone }}
              onPress={() => setShowDone((shown) => !shown)}
              testID="journey-done-toggle"
              style={{ minHeight: MIN_TARGET, flexDirection: "row", alignItems: "center", gap: 10 }}
            >
              <View style={{ width: NODE, height: NODE, borderRadius: NODE / 2, backgroundColor: tokens.ok, alignItems: "center", justifyContent: "center" }}>
                <Check size={18} strokeWidth={2.25} color={tokens.surface} />
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="secondary" bold>
                  {timeline.showDone}
                </Text>
                <Text variant="caption" tone="text2" numberOfLines={showDone ? undefined : 1}>
                  {doneSteps.map((step) => step.title).join(" · ")}
                </Text>
              </View>
              <ChevronDown size={18} strokeWidth={1.75} color={tokens.text2} style={{ transform: [{ rotate: showDone ? "180deg" : "0deg" }] }} />
            </Pressable>
          ) : null}
          <View accessibilityRole="list" accessibilityLabel={timeline.stepsLabel}>
            {view.steps.map((step, index) => {
              const state = progressOf(step.id);
              if (state === "done" && !showDone) return null;
              const expanded = open.has(step.id);
              const last = index === view.steps.length - 1;
              const stepLabel = format(timeline.stepOf, { n: String(step.order), total: String(total) });
              return (
                <View key={step.id} testID={`step-${step.id}`} style={{ flexDirection: "row", gap: 10, paddingBottom: last ? 0 : 12 }}>
                  <View style={{ alignItems: "center", width: NODE }}>
                    <View
                      style={{
                        width: NODE,
                        height: NODE,
                        borderRadius: NODE / 2,
                        borderWidth: 1.5,
                        alignItems: "center",
                        justifyContent: "center",
                        borderColor: state === "done" ? tokens.ok : expanded || state === "current" ? tokens.text : tokens.controlEdge,
                        backgroundColor: state === "done" ? tokens.ok : expanded || state === "current" ? tokens.text : tokens.surface,
                      }}
                    >
                      {state === "done" ? (
                        <Check size={18} strokeWidth={2.25} color={tokens.surface} />
                      ) : (
                        <Text variant="secondary" bold tone={expanded || state === "current" ? "onAccent" : "text"} style={{ color: expanded || state === "current" ? tokens.surface : tokens.text }}>
                          {step.order}
                        </Text>
                      )}
                    </View>
                    {last ? null : <View style={{ flex: 1, width: 2, marginTop: 4, backgroundColor: state === "done" ? tokens.ok : tokens.line }} />}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ expanded }}
                      accessibilityLabel={`${stepLabel} ${step.title}${state === "current" ? `. ${timeline.progressCurrent}` : state === "done" ? `. ${timeline.progressDone}` : state === "optional" ? `. ${timeline.progressOptional}` : ""}${step.timing ? `. ${timeline.period} ${step.timing}` : ""}`}
                      accessibilityHint={m("timeline.pathExpandedHint")}
                      onPress={() => toggle(step.id)}
                      testID={`step-toggle-${step.id}`}
                      style={{ minHeight: MIN_TARGET, gap: 2, justifyContent: "center" }}
                    >
                      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                        <Text variant="body" bold style={{ flex: 1 }}>
                          {step.title}
                        </Text>
                        {state === "done" ? (
                          <Text variant="caption" tone="ok" bold>
                            {timeline.progressDone}
                          </Text>
                        ) : state === "optional" ? (
                          <Text variant="caption" tone="text2" bold testID={`step-optional-${step.id}`}>
                            {timeline.progressOptional}
                          </Text>
                        ) : null}
                        <ChevronDown size={18} strokeWidth={1.75} color={tokens.text2} style={{ transform: [{ rotate: expanded ? "180deg" : "0deg" }] }} />
                      </View>
                      <Text variant="secondary" tone="text2">
                        {step.summary}
                      </Text>
                      {step.timing ? (
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                          <Calendar size={14} strokeWidth={1.75} color={tokens.text2} />
                          <Text variant="caption" tone="text2" style={{ flexShrink: 1 }}>
                            {step.timing}
                          </Text>
                        </View>
                      ) : null}
                    </Pressable>
                    {state === "current" && assisted && step.stageKeys.includes("documents") ? (
                      <Pressable accessibilityRole="link" onPress={() => go("/documents")} testID="journey-open-documents" style={{ minHeight: MIN_TARGET, justifyContent: "center" }}>
                        <Text variant="secondary" tone="accent" bold>
                          {timeline.openDocuments}
                        </Text>
                      </Pressable>
                    ) : null}
                    {expanded ? <StepPanel step={step} /> : null}
                  </View>
                </View>
              );
            })}
          </View>
          <View style={{ gap: 6, marginTop: 8, padding: 12, borderRadius: tokens.radiusItem, backgroundColor: tokens.bg }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Info size={16} strokeWidth={1.75} color={tokens.text2} />
              <Text variant="caption" bold accessibilityRole="header">
                {timeline.notesLabel}
              </Text>
            </View>
            {view.disclaimers.map((text) => (
              <Text key={text} variant="caption" tone="text2">
                {text}
              </Text>
            ))}
          </View>
        </View>
      )}
    </Card>
  );
}
