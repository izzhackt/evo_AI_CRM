"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState, type FormEvent } from "react";
import { EvoLogo } from "@/components/platform/brand/EvoLogo";
import type { Locale } from "@/lib/i18n-data";
import { formatPortalString, getPortalStrings } from "@/lib/portal/i18n";
import {
  STUDENT_APPLICATION_CONSENT_VERSION, STUDENT_APPLICATION_COUNTRIES, STUDENT_APPLICATION_EDUCATION_LEVELS,
  STUDENT_APPLICATION_FUNDING_SOURCES, STUDENT_APPLICATION_GRADE_SCALES, STUDENT_APPLICATION_INTAKE_SEASONS,
  STUDENT_APPLICATION_STUDY_LEVELS, STUDENT_APPLICATION_TUITION_BUDGETS, validateStudentApplicationDraft,
  type StudentApplicationDraft,
} from "@/lib/student-application-contract";
import { ENGLISH_EXAMS, localizedCountryLabel, NATIONALITY_COUNTRIES, STUDY_FIELD_OPTIONS } from "@/lib/student-application-presentation";
import { registerStudentAction } from "@/lib/student-signup-actions";
import { SignupConfirmationPending } from "./SignupConfirmationPending";
import { getSignupConfirmationStrings } from "@/lib/portal/signup-confirmation-i18n";
import { ApplyLangSwitcher } from "./ApplyLangSwitcher";

const STORAGE_KEY = "evo-application-draft-v1";
const INPUT = "min-h-12 w-full rounded-ctl border border-control-edge bg-surface px-3.5 py-3 text-base text-fg outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-focus-ring/25";
// PORT-8c: подписи шагов — неймспейс apply (RU байт-в-байт прежние строки,
// KY полный); порядок ключей — порядок шагов wizard'а.
const STEP_KEYS = ["countries", "intake", "education", "fields", "levels", "nationality", "english", "budget", "account"] as const;
type WizardState = {
  requestId: string; firstName: string; lastName: string; phone: string; destinationCountries: string[];
  intakeSeason: string; intakeYear: string; educationLevel: string; averageGrade: string; gradeScale: string;
  studyFields: string[]; studyLevels: string[]; nationality: string; englishMode: string; englishExam: string;
  englishScore: string; englishLevel: string; tuitionBudget: string; fundingSource: string; consent: boolean;
};

/** PORT-1b: bounded invited-name prefill; never a substitute for the draft. */
export type ApplicationNamePrefill = { firstName: string; lastName: string };

function initialState(requestId: string, draft: StudentApplicationDraft | null, namePrefill: ApplicationNamePrefill | null = null): WizardState {
  return {
    requestId, firstName: draft?.firstName ?? namePrefill?.firstName ?? "", lastName: draft?.lastName ?? namePrefill?.lastName ?? "", phone: draft?.phone ?? "",
    destinationCountries: draft?.destinationCountries ?? [], intakeSeason: draft?.intakeSeason ?? "",
    intakeYear: draft ? String(draft.intakeYear) : "", educationLevel: draft?.educationLevel ?? "",
    averageGrade: draft ? String(draft.averageGrade) : "", gradeScale: draft?.gradeScale ?? "5",
    studyFields: draft?.studyFields ?? [], studyLevels: draft?.studyLevels ?? [], nationality: draft?.nationality ?? "",
    englishMode: draft?.english.mode ?? "", englishExam: draft?.english.mode === "exam" ? draft.english.exam : "ielts",
    englishScore: draft?.english.mode === "exam" ? String(draft.english.score) : "",
    englishLevel: draft?.english.mode === "self" ? draft.english.level : "",
    tuitionBudget: draft?.tuitionBudget ?? "", fundingSource: draft?.fundingSource ?? "", consent: false,
  };
}

function questionnaire(values: WizardState): unknown {
  const { englishMode, englishExam, englishScore, englishLevel, ...rest } = values;
  return { ...rest, firstName: rest.firstName.trim(), lastName: rest.lastName.trim(), phone: rest.phone.trim(),
    schemaVersion: 1, intakeYear: Number(rest.intakeYear), averageGrade: Number(rest.averageGrade),
    english: englishMode === "exam" ? { mode: "exam", exam: englishExam, score: Number(englishScore) } : { mode: "self", level: englishLevel },
    consentVersion: STUDENT_APPLICATION_CONSENT_VERSION };
}

function restoredState(raw: string, base: WizardState): { values: WizardState; step: number } | null {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !parsed.values || typeof parsed.values !== "object") return null;
    const values = { ...base };
    for (const key of Object.keys(base) as (keyof WizardState)[]) {
      const v = parsed.values[key];
      if (Array.isArray(base[key])) {
        if (Array.isArray(v) && v.length <= 15 && v.every((s) => typeof s === "string" && s.length <= 100)) Object.assign(values, { [key]: v });
      } else if (typeof v === typeof base[key] && (typeof v !== "string" || v.length <= 100)) Object.assign(values, { [key]: v });
    }
    return { values, step: Number.isInteger(parsed.step) ? Math.max(0, Math.min(8, parsed.step)) : 0 };
  } catch { return null; }
}

function Choice({ selected, children, onClick }: { selected: boolean; children: React.ReactNode; onClick: () => void }) {
  return <button type="button" aria-pressed={selected} onClick={onClick}
    className={`flex min-h-16 items-center justify-between gap-4 rounded-ctl border px-4 py-4 text-left text-base font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring ${selected ? "border-accent bg-accent-weak text-accent-text" : "border-border bg-surface text-fg hover:border-control-edge hover:bg-surface-2"}`}>
    {children}<span aria-hidden="true" className={`grid size-5 shrink-0 place-items-center rounded-full border text-xs ${selected ? "border-accent bg-accent text-on-accent" : "border-control-edge"}`}>{selected ? "✓" : ""}</span>
  </button>;
}

export function ApplicationWizard({ requestId, draft = null, signedInEmail = null, draftOwnerId = null, expectedRevision = 0, namePrefill = null, year, locale = "ru" }: {
  requestId: string; draft?: StudentApplicationDraft | null; signedInEmail?: string | null; draftOwnerId?: string | null; expectedRevision?: number; namePrefill?: ApplicationNamePrefill | null; year: number; locale?: Locale;
}) {
  const strings = getPortalStrings("apply", locale);
  // Доменные подписи опций: как прежний `LABELS[key] ?? key`, но из словаря.
  const opt = (key: string) => (strings as Record<string, string>)[`opt.${key}`] ?? key;
  const fieldLabel = (value: string) => (strings as Record<string, string>)[`field.${value}`] ?? value;
  const storageKey = draftOwnerId ? `${STORAGE_KEY}:${draftOwnerId}:${expectedRevision}` : STORAGE_KEY;
  const [values, setValues] = useState(() => initialState(requestId, draft, namePrefill));
  const [step, setStep] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [customField, setCustomField] = useState("");
  const [fieldSearch, setFieldSearch] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submittedEmail, setSubmittedEmail] = useState("");
  const [accountEmail, setAccountEmail] = useState("");
  const [result, action, pending] = useActionState(registerStudentAction, { status: "idle" } as const);
  const heading = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    // Restore the external browser draft only after hydration; it contains no password.
    {
      try {
        let raw = sessionStorage.getItem(storageKey);
        // A duplicate signup response cannot prove account creation. Only resume
        // its tab-local draft after login proves the same submitted email.
        if (!raw && signedInEmail && expectedRevision === 0 && !draft) {
          const anonymous = sessionStorage.getItem(STORAGE_KEY);
          if (anonymous && JSON.parse(anonymous).submittedEmail === signedInEmail.toLowerCase()) raw = anonymous;
        }
        const saved = raw ? restoredState(raw, initialState(requestId, draft, namePrefill)) : null;
        if (saved) { setValues(saved.values); setStep(saved.step); }
        if (raw) {
          const stored = JSON.parse(raw);
          setSubmittedEmail(String(stored.submittedEmail ?? "").slice(0, 254));
          setAccountEmail(String(stored.accountEmail ?? stored.submittedEmail ?? "").slice(0, 254));
        }
      } catch { /* The form still works when browser storage is disabled. */ }
    }
    setLoaded(true);
  }, [draft, requestId, storageKey, signedInEmail, expectedRevision, namePrefill]);
  useEffect(() => {
    if (!loaded) return;
    try {
      sessionStorage.setItem(storageKey, JSON.stringify({ values, step, submittedEmail, accountEmail }));
    } catch { /* No false server-save claim is made for a local draft. */ }
  }, [loaded, values, step, submittedEmail, accountEmail, storageKey]);
  useEffect(() => { if (moved.current) heading.current?.focus(); }, [step]);
  function update<K extends keyof WizardState>(key: K, value: WizardState[K]) { setValues((old) => ({ ...old, [key]: value })); setError(""); }
  function toggle(key: "destinationCountries" | "studyFields" | "studyLevels", value: string) {
    const list = values[key];
    const limit = key === "studyFields" ? 10 : key === "studyLevels" ? 6 : 15;
    if (!list.includes(value) && list.length >= limit) { setError(formatPortalString(strings.limitError, { limit: String(limit) })); return; }
    update(key, list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);
  }
  function changeStep(next: number) { moved.current = true; setError(""); setStep(next); }
  function validateStep(): boolean {
    const messages = [
      values.destinationCountries.length ? "" : strings["validation.countries"],
      values.intakeSeason && values.intakeYear ? "" : strings["validation.intake"],
      values.educationLevel && values.averageGrade !== "" ? "" : strings["validation.education"],
      values.studyFields.length ? "" : strings["validation.fields"],
      values.studyLevels.length ? "" : strings["validation.levels"],
      NATIONALITY_COUNTRIES.includes(values.nationality) ? "" : strings["validation.nationality"],
      values.englishMode === "exam" ? (values.englishScore !== "" ? "" : strings["validation.englishScore"]) : values.englishMode === "self" && values.englishLevel ? "" : strings["validation.english"],
      values.tuitionBudget && values.fundingSource ? "" : strings["validation.budget"],
      validateStudentApplicationDraft(questionnaire(values)) ? "" : strings["validation.review"],
    ];
    if (messages[step]) { setError(messages[step]); return false; }
    return form.current?.reportValidity() ?? false;
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    if (step !== 8) { event.preventDefault(); if (validateStep()) changeStep(step + 1); }
    else if (!validateStep()) event.preventDefault();
    else setSubmittedEmail(String(new FormData(event.currentTarget).get("email") ?? "").trim().toLowerCase());
  }
  function preserveAnswers(event: FormEvent<HTMLFormElement>) {
    // A returned action error still resolves the action and triggers React's
    // native form reset. Retain answers; passwords stay out of draft storage.
    event.preventDefault();
    const password = event.currentTarget.elements.namedItem("password");
    if (password instanceof HTMLInputElement) password.value = "";
  }
  useEffect(() => {
    if (result.status === "pending_confirmation" || result.status === "create_unknown") {
      const password = form.current?.elements.namedItem("password");
      if (password instanceof HTMLInputElement) password.value = "";
      setShowPassword(false);
      if (result.status === "create_unknown") heading.current?.focus();
    }
  }, [result]);
  const exam = ENGLISH_EXAMS[values.englishExam as keyof typeof ENGLISH_EXAMS] ?? ENGLISH_EXAMS.ielts;
  const years = Array.from({ length: 7 }, (_, i) => year + i);
  const searchLocale = locale === "ky" ? "ky" : "ru";
  const options = (keys: readonly string[]) => keys.map((key) => <option key={key} value={key}>{opt(key)}</option>);
  const select = (key: keyof WizardState, label: string, keys: readonly string[]) => <label className="grid gap-2 text-sm font-medium text-fg-2">{label}<select className={INPUT} value={String(values[key])} onChange={(event) => update(key, event.target.value)} required><option value="">{strings.choosePlaceholder}</option>{options(keys)}</select></label>;
  const stepCopy = step === 0 || step === 3 || step === 4 ? strings.copyMulti : step === 7 ? strings.copyBudget : step === 8 ? strings.copyAccount : "";
  const serverError = result.status === "password" ? strings["server.password"]
    : result.status === "password_too_long" ? strings["server.password_too_long"]
      : result.status === "rate_limit" ? strings["server.rate_limit"]
      : result.status === "conflict" ? strings["server.conflict"]
        : result.status === "invalid" ? strings["server.invalid"]
          : result.status === "unavailable" ? strings["server.unavailable"] : "";
  return <main className="min-h-dvh bg-bg text-fg" data-testid="public-student-application">
    <header className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-6 sm:px-8">
      <Link href="/apply" aria-label={strings.logoAria} className="rounded-ctl bg-white p-2"><EvoLogo width={146} /></Link>
      <div className="flex flex-wrap items-center justify-end gap-3">
        <ApplyLangSwitcher current={locale} label={strings.languageAria} />
        <Link href={signedInEmail ? "/apply/status" : "/login"} className="inline-flex min-h-11 items-center text-sm font-medium text-fg-2 underline-offset-4 hover:underline">{signedInEmail ? strings.myApplication : strings.loginLink}</Link>
      </div>
    </header>
    <div className="mx-auto max-w-4xl px-4 pb-10 pt-3 sm:px-8 sm:pt-8">
      {result.status === "pending_confirmation" ? <SignupConfirmationPending initial={result} locale={locale} /> : result.status === "create_unknown" ? <section role="alert" className="rounded-card border border-border bg-surface p-5"><h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold text-fg">{getSignupConfirmationStrings(locale).recoveryTitle}</h1><p className="mt-4">{getSignupConfirmationStrings(locale).create_unknown}</p><div className="mt-4 flex flex-wrap gap-6"><Link href="/login" className="inline-flex min-h-11 items-center text-accent-text underline">{getSignupConfirmationStrings(locale).login}</Link><a href="mailto:evo@evoadmissions.com" className="inline-flex min-h-11 items-center text-accent-text underline">{getSignupConfirmationStrings(locale).support}</a></div></section> : <>
      <div className="mb-6 flex items-center justify-between gap-4 text-sm"><span className="font-medium text-fg-2">{strings[`step.${STEP_KEYS[step]}`]}</span><span aria-live="polite" className="text-fg-2">{formatPortalString(strings.stepOf, { step: String(step + 1) })}</span></div>
      <div role="progressbar" aria-label={strings.progressAria} aria-valuemin={0} aria-valuemax={9} aria-valuenow={step + 1} className="mb-8 flex gap-1.5">{STEP_KEYS.map((key, i) => <span key={key} className={`h-1.5 flex-1 rounded-full transition-colors ${i <= step ? "bg-accent" : "bg-border"}`} />)}</div>
      <form ref={form} action={action} onSubmit={submit} onReset={preserveAnswers} className="rounded-card border border-border bg-surface px-5 pb-5 pt-7 sm:px-10 sm:pb-8 sm:pt-10">
        <input name="questionnaire" type="hidden" value={JSON.stringify(questionnaire(values))} />
        <input name="expected_revision" type="hidden" value={expectedRevision} />
        {step !== 8 && <><input name="email" type="hidden" value={signedInEmail ?? ""} /><input name="password" type="hidden" value="" /></>}
        <div key={step} className="page-in min-h-[340px] motion-reduce:animate-none">
          <h1 tabIndex={-1} ref={heading} className="max-w-xl text-2xl font-semibold leading-tight tracking-tight outline-none sm:text-3xl">{step === 8 && signedInEmail ? strings.contactsHeading : strings[`question.${STEP_KEYS[step]}`]}</h1>
          {stepCopy && <p className="mt-3 text-sm leading-6 text-fg-2">{stepCopy}</p>}
          <div className="mt-7 space-y-5">
            {step === 0 && <div className="grid gap-3 sm:grid-cols-3">{STUDENT_APPLICATION_COUNTRIES.map((country) => <Choice key={country} selected={values.destinationCountries.includes(country)} onClick={() => toggle("destinationCountries", country)}><span className="flex items-center gap-3"><span aria-hidden="true" className="text-2xl">{String.fromCodePoint(...[...country].map((c) => c.charCodeAt(0) + 127397))}</span>{opt(country)}</span></Choice>)}</div>}
            {step === 1 && <div className="grid max-w-xl gap-5 sm:grid-cols-2">{select("intakeSeason", strings.intakeLabel, STUDENT_APPLICATION_INTAKE_SEASONS)}<label className="grid gap-2 text-sm font-medium text-fg-2">{strings.yearLabel}<select className={INPUT} required value={values.intakeYear} onChange={(e) => update("intakeYear", e.target.value)}><option value="">{strings.chooseYear}</option>{years.map((y) => <option key={y} value={y}>{y}</option>)}</select></label></div>}
            {step === 2 && <div className="max-w-xl space-y-5">{select("educationLevel", strings.educationLabel, STUDENT_APPLICATION_EDUCATION_LEVELS)}<div className="grid gap-5 sm:grid-cols-2"><label className="grid gap-2 text-sm font-medium text-fg-2">{strings.gradeLabel}<input className={INPUT} type="number" min="0" max={Number(values.gradeScale)} step="0.01" required value={values.averageGrade} onChange={(e) => update("averageGrade", e.target.value)} inputMode="decimal" /></label><label className="grid gap-2 text-sm font-medium text-fg-2">{strings.gradeScaleLabel}<select className={INPUT} value={values.gradeScale} onChange={(e) => update("gradeScale", e.target.value)}>{STUDENT_APPLICATION_GRADE_SCALES.map((scale) => <option key={scale} value={scale}>{formatPortalString(strings.gradeScaleOf, { scale })}</option>)}</select></label></div></div>}
            {step === 3 && <><label className="grid gap-2 text-sm font-medium text-fg-2">{strings.fieldSearchLabel}<input className={INPUT} value={fieldSearch} onChange={(e) => setFieldSearch(e.target.value)} placeholder={strings.fieldSearchPlaceholder} type="search" /></label><div className="grid gap-3 sm:grid-cols-2">{STUDY_FIELD_OPTIONS.filter((item) => item.toLocaleLowerCase("ru").includes(fieldSearch.toLocaleLowerCase(searchLocale)) || fieldLabel(item).toLocaleLowerCase(searchLocale).includes(fieldSearch.toLocaleLowerCase(searchLocale))).map((field) => <Choice key={field} selected={values.studyFields.includes(field)} onClick={() => toggle("studyFields", field)}>{fieldLabel(field)}</Choice>)}</div><div className="flex flex-wrap gap-2">{values.studyFields.filter((s) => !(STUDY_FIELD_OPTIONS as readonly string[]).includes(s)).map((s) => <button type="button" key={s} onClick={() => toggle("studyFields", s)} className="min-h-11 rounded-ctl border border-accent bg-accent-weak px-3 text-sm text-accent-text" aria-label={formatPortalString(strings.removeField, { field: s })}>{s} ×</button>)}</div><div className="flex items-end gap-3"><label className="grid min-w-0 flex-1 gap-2 text-sm font-medium text-fg-2">{strings.customFieldLabel}<input className={INPUT} maxLength={100} value={customField} onChange={(e) => setCustomField(e.target.value)} /></label><button type="button" disabled={!customField.trim()} onClick={() => { const field = customField.trim(); if (field && !values.studyFields.includes(field)) toggle("studyFields", field); setCustomField(""); }} className="min-h-12 rounded-ctl border border-control-edge px-4 text-sm font-medium disabled:opacity-50">{strings.addField}</button></div></>}
            {step === 4 && <div className="grid gap-3 sm:grid-cols-2">{STUDENT_APPLICATION_STUDY_LEVELS.map((level) => <Choice key={level} selected={values.studyLevels.includes(level)} onClick={() => toggle("studyLevels", level)}>{opt(level)}</Choice>)}</div>}
            {step === 5 && <label className="grid max-w-xl gap-2 text-sm font-medium text-fg-2">{strings.nationalityLabel}<select required className={INPUT} value={values.nationality} onChange={(e) => update("nationality", e.target.value)}><option value="">{strings.chooseCountry}</option>{NATIONALITY_COUNTRIES.map((code) => ({ code, name: localizedCountryLabel(code, locale) })).sort((a, b) => a.name.localeCompare(b.name, searchLocale)).map(({ code, name }) => <option key={code} value={code}>{name}</option>)}</select></label>}
            {step === 6 && <div className="max-w-xl space-y-6"><fieldset><legend className="mb-3 text-sm font-medium text-fg-2">{strings.englishLegend}</legend><div className="grid gap-3 sm:grid-cols-2"><Choice selected={values.englishMode === "exam"} onClick={() => update("englishMode", "exam")}>{strings.englishYes}</Choice><Choice selected={values.englishMode === "self"} onClick={() => update("englishMode", "self")}>{strings.englishNo}</Choice></div></fieldset>{values.englishMode === "exam" && <div className="grid gap-5 sm:grid-cols-2">{select("englishExam", strings.examLabel, Object.keys(ENGLISH_EXAMS))}<label className="grid gap-2 text-sm font-medium text-fg-2">{strings.examScoreLabel}<input required className={INPUT} type="number" min={exam.min} max={exam.max} step={exam.step} value={values.englishScore} onChange={(e) => update("englishScore", e.target.value)} inputMode="decimal" /></label></div>}{values.englishMode === "self" && select("englishLevel", strings.selfLevelLabel, ["beginner", "intermediate", "advanced", "fluent"])}</div>}
            {step === 7 && <div className="max-w-xl space-y-5">{select("tuitionBudget", strings.budgetLabel, STUDENT_APPLICATION_TUITION_BUDGETS)}{select("fundingSource", strings.fundingLabel, STUDENT_APPLICATION_FUNDING_SOURCES)}</div>}
            {step === 8 && <div className="space-y-5"><div className="grid gap-5 sm:grid-cols-2"><label className="grid gap-2 text-sm font-medium text-fg-2">{strings.firstNameLabel}<input required className={INPUT} autoComplete="given-name" maxLength={60} value={values.firstName} onChange={(e) => update("firstName", e.target.value)} /></label><label className="grid gap-2 text-sm font-medium text-fg-2">{strings.lastNameLabel}<input required className={INPUT} autoComplete="family-name" maxLength={60} value={values.lastName} onChange={(e) => update("lastName", e.target.value)} /></label><label className="grid gap-2 text-sm font-medium text-fg-2">{strings.phoneLabel}<input required className={INPUT} type="tel" autoComplete="tel" maxLength={40} placeholder={strings.phonePlaceholder} value={values.phone} onChange={(e) => update("phone", e.target.value)} /></label>{signedInEmail ? <div className="grid content-start gap-2 text-sm font-medium text-fg-2"><span>{strings.accountEmailLabel}</span><p className="break-all py-3 text-base font-normal text-fg">{signedInEmail}</p><input name="email" type="hidden" value={signedInEmail} /></div> : <label className="grid gap-2 text-sm font-medium text-fg-2">{strings.emailLabel}<input required className={INPUT} name="email" type="email" autoComplete="email" maxLength={254} value={accountEmail} onChange={(event) => setAccountEmail(event.target.value)} /></label>}</div>{signedInEmail ? <input name="password" type="hidden" value="" /> : <label className="grid max-w-xl gap-2 text-sm font-medium text-fg-2">{strings.passwordLabel}<div className="flex gap-2"><input required className={INPUT} name="password" type={showPassword ? "text" : "password"} autoComplete="new-password" minLength={12} maxLength={72} aria-describedby="password-hint" /><button type="button" aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)} className="min-h-12 rounded-ctl px-2 text-sm text-accent-text">{showPassword ? strings.hidePassword : strings.showPassword}</button></div><span id="password-hint" className="text-sm font-normal text-fg-2">{strings.passwordHint}</span></label>}<label className="flex cursor-pointer items-start gap-3 border-t border-border pt-5 text-sm leading-6 text-fg-2"><input type="checkbox" required checked={values.consent} onChange={(e) => update("consent", e.target.checked)} className="mt-1 size-5 shrink-0 accent-accent" /><span>{strings.consentLabel}</span></label></div>}
          </div>
        </div>
        {(error || serverError) && <p role="alert" className="mt-6 rounded-ctl bg-danger-weak p-3 text-sm leading-6 text-danger">{error || serverError}{!error && result.status === "conflict" && <> <Link href="/login" className="font-medium underline underline-offset-4">{strings.goToLogin}</Link></>}</p>}
        <footer className="mt-8 flex items-center justify-between gap-3 border-t border-border pt-5">
          <button type="button" disabled={step === 0 || pending} onClick={() => changeStep(step - 1)} className="min-h-12 rounded-ctl px-4 font-medium text-fg-2 hover:bg-surface-2 disabled:invisible">{strings.back}</button>
          <button type="submit" disabled={pending || !loaded} className="min-h-12 rounded-ctl bg-accent px-6 font-semibold text-on-accent transition-colors hover:bg-accent-2 disabled:opacity-60">{pending ? strings.saving : step === 8 ? signedInEmail ? strings.submitApplication : strings.createAccount : strings.continueButton}</button>
        </footer>
      </form>
      </>}
    </div>
  </main>;
}
