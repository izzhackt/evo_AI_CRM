// Мастер анкеты (порт ApplicationWizard.tsx веба). 7 шагов, прогресс, «Назад/Далее», проверка
// каждого шага правилами веба, черновик на устройстве без пароля.
// Контейнер даёт `onSubmit`: регистрация по ссылке (аноним) или submit_student_application_v1 (вошедший).
import { randomUUID } from "expo-crypto";
import { useEffect, useMemo, useRef, useState } from "react";
import { KeyboardAvoidingView, Linking, Platform, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  clearDraft,
  loadDraft,
  saveDraft,
  type DraftScope,
} from "@/features/registration/draft-store";
import {
  addCustomField,
  initialValues,
  LAST_STEP_INDEX,
  SELECTION_LIMITS,
  toggleSelection,
  validateStep,
  validDraft,
  WIZARD_STEPS,
  type NamePrefill,
  type SelectionKey,
  type ValidationKey,
  type WizardValues,
} from "@/features/registration/wizard-model";
import { CheckRow, ChoiceRow, OptionGroup, PickerField, type Option } from "@/features/registration/WizardFields";
import { useLang } from "@/i18n/LangProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";
import { AI_CONSENT_PRIVACY_URL } from "@web/lib/portal/ai-consent";
import {
  STUDENT_APPLICATION_EDUCATION_LEVELS,
  STUDENT_APPLICATION_FUNDING_SOURCES,
  STUDENT_APPLICATION_GRADE_SCALES,
  STUDENT_APPLICATION_INTAKE_SEASONS,
  STUDENT_APPLICATION_STUDY_LEVELS,
  STUDENT_APPLICATION_TUITION_BUDGETS,
  type StudentApplicationDraft,
} from "@/features/registration/application-contract";
import { ENGLISH_EXAMS, localizedCountryLabel, NATIONALITY_COUNTRIES, STUDY_FIELD_OPTIONS } from "@/features/registration/application-contract";
import { studyCountryOptions } from "@web/lib/study-countries";

export type WizardSubmitInput = Readonly<{
  values: WizardValues;
  draft: StudentApplicationDraft;
  /** Пароль нового аккаунта; `null` у вошедшего. Не сохраняется нигде. */
  password: string | null;
  aiConsent: boolean;
}>;

/** Сообщение об ошибке для показа или `null`, если отправка принята. */
export type WizardSubmit = (input: WizardSubmitInput) => Promise<string | null>;

export type ApplicationWizardProps = Readonly<{
  /** Аноним: создаётся аккаунт (email и пароль). Вошедший: только анкета, почта из сессии. */
  signedInEmail: string | null;
  scope: DraftScope;
  /** Анкета, из которой начинаются ответы (исправление отклонённой). */
  initialDraft?: StudentApplicationDraft | null;
  /** Имя из приглашения (invite-acceptance), если получено. */
  namePrefill?: NamePrefill | null;
  onSubmit: WizardSubmit;
  /** Слева сверху на первом шаге: «Назад» из мастера (выход к вводу ссылки или входу). */
  onExit?: () => void;
  exitLabel?: string;
}>;

type AnyStrings = Readonly<Record<string, string>>;

export function ApplicationWizard({ signedInEmail, scope, initialDraft = null, namePrefill = null, onSubmit, onExit, exitLabel }: ApplicationWizardProps) {
  const { tokens } = useTheme();
  const insets = useSafeAreaInsets();
  const { lang, m, format, t } = useLang();
  const strings = t("apply") as unknown as AnyStrings;
  const S = (key: string) => strings[key] ?? key;
  const scrollRef = useRef<{ scrollTo: (options: { y: number; animated: boolean }) => void } | null>(null);
  const [requestId] = useState(() => randomUUID());
  const base = useMemo(() => initialValues(requestId, initialDraft, namePrefill, signedInEmail ?? ""), [requestId, initialDraft, namePrefill, signedInEmail]);

  const [values, setValues] = useState<WizardValues>(base);
  const [step, setStep] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState("");
  const [aiConsent, setAiConsent] = useState(false);
  const [fieldSearch, setFieldSearch] = useState("");
  const [customField, setCustomField] = useState("");

  // Восстановить черновик устройства один раз. Пароль и согласия в нём не бывают.
  useEffect(() => {
    let cancelled = false;
    void loadDraft(scope, base).then((stored) => {
      if (cancelled) return;
      if (stored) {
        setValues({ ...stored.values, email: signedInEmail ?? stored.values.email });
        setStep(stored.step);
      }
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [scope, base, signedInEmail]);

  useEffect(() => {
    if (loaded) void saveDraft(scope, values, step);
  }, [loaded, scope, values, step]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [step]);

  const update = <K extends keyof WizardValues>(key: K, value: WizardValues[K]) => {
    setValues((old) => ({ ...old, [key]: value }));
    setError(null);
  };

  const toggle = (key: SelectionKey, value: string) => {
    const result = toggleSelection(values, key, value);
    setValues(result.values);
    setError(result.limitExceeded ? format(S("limitError"), { limit: String(SELECTION_LIMITS[key]) }) : null);
  };

  const messageFor = (key: ValidationKey): string => (key.startsWith("wizard.") ? m(key as Parameters<typeof m>[0]) : S(key));
  const context = { password: signedInEmail ? null : password, aiConsent, signedInEmail };

  const goNext = async () => {
    if (busy) return;
    const failure = validateStep(step, values, context);
    if (failure) {
      setError(messageFor(failure));
      return;
    }
    setError(null);
    if (step < LAST_STEP_INDEX) {
      setStep(step + 1);
      return;
    }
    const draft = validDraft(values);
    if (!draft) {
      setError(S("validation.review"));
      return;
    }
    setBusy(true);
    try {
      const message = await onSubmit({ values, draft, password: signedInEmail ? null : password, aiConsent });
      if (message) setError(message);
      else await clearDraft(scope);
    } finally {
      setBusy(false);
    }
  };

  const goBack = () => {
    setError(null);
    if (step > 0) setStep(step - 1);
    else onExit?.();
  };

  const opt = (key: string): string => S(`opt.${key}`);
  const optionsOf = (keys: readonly string[]): Option[] => keys.map((key) => ({ value: key, label: opt(key) }));
  const year = Math.max(2026, new Date().getFullYear());
  const years: Option[] = Array.from({ length: 7 }, (_, i) => ({ value: String(year + i), label: String(year + i) }));
  const countries = useMemo(() => studyCountryOptions(lang, { undecided: true }), [lang]);
  const nationalityOptions = useMemo<Option[]>(
    () =>
      NATIONALITY_COUNTRIES.map((code) => ({ value: code, label: localizedCountryLabel(code, lang) })).sort((a, b) => a.label.localeCompare(b.label, lang === "ky" ? "ky" : "ru")),
    [lang],
  );
  const exam = ENGLISH_EXAMS[values.englishExam as keyof typeof ENGLISH_EXAMS] ?? ENGLISH_EXAMS.ielts;

  const stepKey = WIZARD_STEPS[step];
  const title = (() => {
    switch (stepKey) {
      case "educationLevels":
        return m("wizard.question.educationLevels");
      case "nationalityEnglish":
        return m("wizard.question.nationalityEnglish");
      case "account":
        return signedInEmail ? S("contactsHeading") : S("question.account");
      default:
        return S(`question.${stepKey}`);
    }
  })();
  const stepName = stepKey === "educationLevels" ? m("wizard.step.educationLevels") : stepKey === "nationalityEnglish" ? m("wizard.step.nationalityEnglish") : S(`step.${stepKey}`);
  const copy = stepKey === "countries" || stepKey === "fields" ? S("copyMulti") : stepKey === "budget" ? S("copyBudget") : stepKey === "account" ? S("copyAccount") : "";

  const fieldChoices = STUDY_FIELD_OPTIONS.filter((item) => {
    const needle = fieldSearch.trim().toLocaleLowerCase();
    return needle === "" || item.toLocaleLowerCase().includes(needle) || S(`field.${item}`).toLocaleLowerCase().includes(needle);
  });
  const customFields = values.studyFields.filter((field) => !(STUDY_FIELD_OPTIONS as readonly string[]).includes(field));

  const [policyBefore, policyAfter = ""] = S("consentLabel").split("{policy}");
  const lastLabel = signedInEmail ? S("submitApplication") : S("createAccount");

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: tokens.bg }}>
      <ScrollView
        ref={(node) => {
          scrollRef.current = node;
        }}
        testID="wizard-scroll"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 16, paddingTop: insets.top + 16, paddingBottom: Math.max(insets.bottom, 16) + 16, gap: 16 }}
      >
        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <Text variant="secondary" tone="text2" bold style={{ flexShrink: 1 }}>
              {stepName}
            </Text>
            <Text variant="secondary" tone="text2" accessibilityLiveRegion="polite" testID="wizard-step-label">
              {format(m("wizard.stepOf"), { step: String(step + 1), total: String(WIZARD_STEPS.length) })}
            </Text>
          </View>
          <View
            accessibilityRole="progressbar"
            accessibilityLabel={S("progressAria")}
            accessibilityValue={{ min: 1, max: WIZARD_STEPS.length, now: step + 1 }}
            style={{ flexDirection: "row", gap: 4 }}
          >
            {WIZARD_STEPS.map((key, i) => (
              <View key={key} style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: i <= step ? tokens.accent : tokens.line }} />
            ))}
          </View>
        </View>

        <Card>
          <Text variant="title" accessibilityRole="header">
            {title}
          </Text>
          {copy ? (
            <Text variant="secondary" tone="text2">
              {copy}
            </Text>
          ) : null}

          {stepKey === "countries" ? (
            <View style={{ gap: 8 }}>
              {countries.map(({ code, label }) => (
                <ChoiceRow key={code} label={label} multi selected={values.destinationCountries.includes(code)} onPress={() => toggle("destinationCountries", code)} testID={`country-${code}`} />
              ))}
            </View>
          ) : null}

          {stepKey === "intake" ? (
            <View style={{ gap: 16 }}>
              <OptionGroup legend={S("intakeLabel")} options={optionsOf(STUDENT_APPLICATION_INTAKE_SEASONS)} value={values.intakeSeason} onChange={(v) => update("intakeSeason", v)} testIDPrefix="season" />
              <OptionGroup legend={S("yearLabel")} options={years} value={values.intakeYear} onChange={(v) => update("intakeYear", v)} testIDPrefix="year" />
            </View>
          ) : null}

          {stepKey === "educationLevels" ? (
            <View style={{ gap: 16 }}>
              <OptionGroup legend={S("educationLabel")} options={optionsOf(STUDENT_APPLICATION_EDUCATION_LEVELS)} value={values.educationLevel} onChange={(v) => update("educationLevel", v)} testIDPrefix="education" />
              <TextField
                label={S("gradeLabel")}
                value={values.averageGrade}
                onChangeText={(v) => update("averageGrade", v)}
                keyboardType="decimal-pad"
                maxLength={8}
                hint={m("wizard.gradeHint").replace("{scale}", values.gradeScale)}
                testID="grade-input"
              />
              <OptionGroup
                legend={S("gradeScaleLabel")}
                options={STUDENT_APPLICATION_GRADE_SCALES.map((scale) => ({ value: scale, label: format(S("gradeScaleOf"), { scale }) }))}
                value={values.gradeScale}
                onChange={(v) => update("gradeScale", v)}
                testIDPrefix="scale"
              />
              <View style={{ gap: 8 }}>
                <Text variant="secondary" tone="text2" bold>
                  {S("question.levels")}
                </Text>
                {STUDENT_APPLICATION_STUDY_LEVELS.map((level) => (
                  <ChoiceRow key={level} label={opt(level)} multi selected={values.studyLevels.includes(level)} onPress={() => toggle("studyLevels", level)} testID={`level-${level}`} />
                ))}
              </View>
            </View>
          ) : null}

          {stepKey === "fields" ? (
            <View style={{ gap: 12 }}>
              <TextField label={S("fieldSearchLabel")} value={fieldSearch} onChangeText={setFieldSearch} placeholder={S("fieldSearchPlaceholder")} autoCorrect={false} testID="field-search" />
              <View style={{ gap: 8 }}>
                {fieldChoices.map((item) => (
                  <ChoiceRow key={item} label={S(`field.${item}`)} multi selected={values.studyFields.includes(item)} onPress={() => toggle("studyFields", item)} testID={`field-${item}`} />
                ))}
              </View>
              {customFields.map((field) => (
                <ChoiceRow key={field} label={field} multi selected onPress={() => toggle("studyFields", field)} testID={`custom-${field}`} />
              ))}
              <TextField label={S("customFieldLabel")} value={customField} onChangeText={setCustomField} maxLength={100} testID="custom-field-input" />
              <Button
                label={S("addField")}
                variant="ghost"
                disabled={customField.trim() === ""}
                onPress={() => {
                  const result = addCustomField(values, customField);
                  setValues(result.values);
                  setError(result.limitExceeded ? format(S("limitError"), { limit: String(SELECTION_LIMITS.studyFields) }) : null);
                  setCustomField("");
                }}
                testID="custom-field-add"
              />
            </View>
          ) : null}

          {stepKey === "nationalityEnglish" ? (
            <View style={{ gap: 16 }}>
              <PickerField
                label={S("nationalityLabel")}
                value={values.nationality}
                options={nationalityOptions}
                placeholder={S("chooseCountry")}
                searchLabel={m("wizard.pickerSearch")}
                closeLabel={m("wizard.pickerClose")}
                emptyLabel={m("wizard.pickerEmpty")}
                onChange={(v) => update("nationality", v)}
                testID="nationality"
              />
              <OptionGroup
                legend={S("englishLegend")}
                options={[
                  { value: "exam", label: S("englishYes") },
                  { value: "self", label: S("englishNo") },
                ]}
                value={values.englishMode}
                onChange={(v) => update("englishMode", v === "exam" ? "exam" : "self")}
                testIDPrefix="english-mode"
              />
              {values.englishMode === "exam" ? (
                <View style={{ gap: 16 }}>
                  <OptionGroup legend={S("examLabel")} options={optionsOf(Object.keys(ENGLISH_EXAMS))} value={values.englishExam} onChange={(v) => update("englishExam", v)} testIDPrefix="exam" />
                  <TextField
                    label={S("examScoreLabel")}
                    value={values.englishScore}
                    onChangeText={(v) => update("englishScore", v)}
                    keyboardType="decimal-pad"
                    maxLength={6}
                    hint={format(m("wizard.scoreHint"), { min: String(exam.min), max: String(exam.max), step: String(exam.step) })}
                    testID="english-score"
                  />
                </View>
              ) : null}
              {values.englishMode === "self" ? (
                <OptionGroup legend={S("selfLevelLabel")} options={optionsOf(["beginner", "intermediate", "advanced", "fluent"])} value={values.englishLevel} onChange={(v) => update("englishLevel", v)} testIDPrefix="level-self" />
              ) : null}
            </View>
          ) : null}

          {stepKey === "budget" ? (
            <View style={{ gap: 16 }}>
              <OptionGroup legend={S("budgetLabel")} options={optionsOf(STUDENT_APPLICATION_TUITION_BUDGETS)} value={values.tuitionBudget} onChange={(v) => update("tuitionBudget", v)} testIDPrefix="budget" />
              <OptionGroup legend={S("fundingLabel")} options={optionsOf(STUDENT_APPLICATION_FUNDING_SOURCES)} value={values.fundingSource} onChange={(v) => update("fundingSource", v)} testIDPrefix="funding" />
            </View>
          ) : null}

          {stepKey === "account" ? (
            <View style={{ gap: 16 }}>
              <TextField label={S("firstNameLabel")} value={values.firstName} onChangeText={(v) => update("firstName", v)} autoComplete="given-name" textContentType="givenName" maxLength={60} returnKeyType="next" testID="first-name" />
              <TextField label={S("lastNameLabel")} value={values.lastName} onChangeText={(v) => update("lastName", v)} autoComplete="family-name" textContentType="familyName" maxLength={60} returnKeyType="next" testID="last-name" />
              <TextField label={S("phoneLabel")} value={values.phone} onChangeText={(v) => update("phone", v)} keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" maxLength={40} placeholder={S("phonePlaceholder")} testID="phone" />
              {signedInEmail ? (
                <View style={{ gap: 4 }}>
                  <Text variant="secondary" tone="text2" bold>
                    {S("accountEmailLabel")}
                  </Text>
                  <Text variant="body" testID="signed-in-email">
                    {signedInEmail}
                  </Text>
                </View>
              ) : (
                <>
                  <TextField
                    label={S("emailLabel")}
                    value={values.email}
                    onChangeText={(v) => update("email", v)}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="email"
                    textContentType="emailAddress"
                    maxLength={254}
                    hint={m("wizard.emailNote")}
                    testID="email"
                  />
                  <TextField
                    label={S("passwordLabel")}
                    value={password}
                    onChangeText={(v) => {
                      setPassword(v);
                      setError(null);
                    }}
                    secure
                    showLabel={S("showPassword")}
                    hideLabel={S("hidePassword")}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="new-password"
                    textContentType="newPassword"
                    maxLength={128}
                    hint={S("passwordHint")}
                    testID="password"
                  />
                </>
              )}
              <CheckRow checked={values.consent} onToggle={() => update("consent", !values.consent)} testID="consent">
                <Text variant="secondary" tone="text2">
                  {policyBefore}
                  <Text variant="secondary" tone="accent" bold onPress={() => void Linking.openURL(AI_CONSENT_PRIVACY_URL)} accessibilityRole="link">
                    {S("consentPolicyLink")}
                  </Text>
                  {policyAfter}
                </Text>
              </CheckRow>
              <CheckRow
                checked={aiConsent}
                onToggle={() => {
                  setAiConsent(!aiConsent);
                  setError(null);
                }}
                testID="ai-consent"
              >
                <Text variant="secondary" tone="text2">
                  {S("aiConsentLabel")}
                </Text>
              </CheckRow>
            </View>
          ) : null}

          {error ? (
            <Text variant="secondary" tone="error" accessibilityRole="alert" testID="wizard-error">
              {error}
            </Text>
          ) : null}
        </Card>

        <View style={{ gap: 8 }}>
          <Button
            label={step === LAST_STEP_INDEX ? (busy ? S("saving") : lastLabel) : m("wizard.next")}
            onPress={() => void goNext()}
            busy={busy}
            testID="wizard-next"
          />
          {step > 0 || onExit ? <Button label={step > 0 ? S("back") : (exitLabel ?? S("back"))} variant="ghost" onPress={goBack} disabled={busy} testID="wizard-back" /> : null}
          <Text variant="caption" tone="text2" style={{ textAlign: "center" }}>
            {m("wizard.draftHint")}
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
