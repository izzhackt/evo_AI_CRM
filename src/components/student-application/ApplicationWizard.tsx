"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState, type FormEvent } from "react";
import { EvoLogo } from "@/components/platform/brand/EvoLogo";
import {
  STUDENT_APPLICATION_CONSENT_VERSION, STUDENT_APPLICATION_COUNTRIES, STUDENT_APPLICATION_EDUCATION_LEVELS,
  STUDENT_APPLICATION_FUNDING_SOURCES, STUDENT_APPLICATION_GRADE_SCALES, STUDENT_APPLICATION_INTAKE_SEASONS,
  STUDENT_APPLICATION_STUDY_LEVELS, STUDENT_APPLICATION_TUITION_BUDGETS, validateStudentApplicationDraft,
  type StudentApplicationDraft,
} from "@/lib/student-application-contract";
import { APPLICATION_LABELS as LABELS, countryLabel, ENGLISH_EXAMS, NATIONALITY_COUNTRIES, STUDY_FIELD_OPTIONS } from "@/lib/student-application-presentation";
import { registerStudentAction } from "@/lib/student-signup-actions";

const STEPS = ["Страны", "Начало учёбы", "Образование", "Направления", "Ступень", "Гражданство", "Английский", "Бюджет", "Аккаунт"];
const QUESTIONS = ["Где вы хотите учиться?", "Когда планируете начать?", "Какое у вас образование?", "Что вы хотите изучать?", "На какую программу поступаете?", "Какое у вас гражданство?", "Расскажите о вашем английском", "Какой бюджет на обучение?", "Создайте аккаунт EVO"];
const STORAGE_KEY = "evo-application-draft-v1";
const INPUT = "min-h-12 w-full rounded-ctl border border-control-edge bg-surface px-3.5 py-3 text-base text-fg outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-focus-ring/25";
type WizardState = {
  requestId: string; firstName: string; lastName: string; phone: string; destinationCountries: string[];
  intakeSeason: string; intakeYear: string; educationLevel: string; averageGrade: string; gradeScale: string;
  studyFields: string[]; studyLevels: string[]; nationality: string; englishMode: string; englishExam: string;
  englishScore: string; englishLevel: string; tuitionBudget: string; fundingSource: string; consent: boolean;
};

function initialState(requestId: string, draft: StudentApplicationDraft | null): WizardState {
  return {
    requestId, firstName: draft?.firstName ?? "", lastName: draft?.lastName ?? "", phone: draft?.phone ?? "",
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

export function ApplicationWizard({ requestId, draft = null, signedInEmail = null, draftOwnerId = null, expectedRevision = 0, year }: {
  requestId: string; draft?: StudentApplicationDraft | null; signedInEmail?: string | null; draftOwnerId?: string | null; expectedRevision?: number; year: number;
}) {
  const storageKey = draftOwnerId ? `${STORAGE_KEY}:${draftOwnerId}:${expectedRevision}` : STORAGE_KEY;
  const [values, setValues] = useState(() => initialState(requestId, draft));
  const [step, setStep] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [customField, setCustomField] = useState("");
  const [fieldSearch, setFieldSearch] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submittedEmail, setSubmittedEmail] = useState("");
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
        const saved = raw ? restoredState(raw, initialState(requestId, draft)) : null;
        if (saved) { setValues(saved.values); setStep(saved.step); }
        if (raw) setSubmittedEmail(String(JSON.parse(raw).submittedEmail ?? "").slice(0, 254));
      } catch { /* The form still works when browser storage is disabled. */ }
    }
    setLoaded(true);
  }, [draft, requestId, storageKey, signedInEmail, expectedRevision]);
  useEffect(() => {
    if (!loaded) return;
    try {
      sessionStorage.setItem(storageKey, JSON.stringify({ values, step, submittedEmail }));
    } catch { /* No false server-save claim is made for a local draft. */ }
  }, [loaded, values, step, submittedEmail, storageKey]);
  useEffect(() => { if (moved.current) heading.current?.focus(); }, [step]);
  function update<K extends keyof WizardState>(key: K, value: WizardState[K]) { setValues((old) => ({ ...old, [key]: value })); setError(""); }
  function toggle(key: "destinationCountries" | "studyFields" | "studyLevels", value: string) {
    const list = values[key];
    const limit = key === "studyFields" ? 10 : key === "studyLevels" ? 6 : 15;
    if (!list.includes(value) && list.length >= limit) { setError(`Можно выбрать до ${limit} вариантов.`); return; }
    update(key, list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);
  }
  function changeStep(next: number) { moved.current = true; setError(""); setStep(next); }
  function validateStep(): boolean {
    const messages = [
      values.destinationCountries.length ? "" : "Выберите хотя бы одну страну.",
      values.intakeSeason && values.intakeYear ? "" : "Выберите набор и год.",
      values.educationLevel && values.averageGrade !== "" ? "" : "Укажите образование и средний балл.",
      values.studyFields.length ? "" : "Выберите направление или добавьте своё.",
      values.studyLevels.length ? "" : "Выберите хотя бы одну ступень обучения.",
      NATIONALITY_COUNTRIES.includes(values.nationality) ? "" : "Выберите гражданство из списка.",
      values.englishMode === "exam" ? (values.englishScore !== "" ? "" : "Укажите результат экзамена.") : values.englishMode === "self" && values.englishLevel ? "" : "Укажите результат экзамена или ваш уровень.",
      values.tuitionBudget && values.fundingSource ? "" : "Выберите бюджет и источник финансирования.",
      validateStudentApplicationDraft(questionnaire(values)) ? "" : "Проверьте анкету и подтвердите согласие.",
    ];
    if (messages[step]) { setError(messages[step]); return false; }
    return form.current?.reportValidity() ?? false;
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    if (step !== 8) { event.preventDefault(); if (validateStep()) changeStep(step + 1); }
    else if (!validateStep()) event.preventDefault();
    else setSubmittedEmail(String(new FormData(event.currentTarget).get("email") ?? "").trim().toLowerCase());
  }
  const exam = ENGLISH_EXAMS[values.englishExam as keyof typeof ENGLISH_EXAMS] ?? ENGLISH_EXAMS.ielts;
  const years = Array.from({ length: 7 }, (_, i) => year + i);
  const options = (keys: readonly string[]) => keys.map((key) => <option key={key} value={key}>{LABELS[key] ?? key}</option>);
  const select = (key: keyof WizardState, label: string, keys: readonly string[]) => <label className="grid gap-2 text-sm font-medium text-fg-2">{label}<select className={INPUT} value={String(values[key])} onChange={(event) => update(key, event.target.value)} required><option value="">Выберите</option>{options(keys)}</select></label>;
  const stepCopy = step === 0 || step === 3 || step === 4 ? "Можно выбрать несколько вариантов." : step === 7 ? "Только обучение за один год, без проживания." : step === 8 ? "После подтверждения email команда EVO рассмотрит вашу анкету." : "";
  const serverError = result.status === "password" ? "Используйте пароль от 12 до 128 символов."
    : result.status === "rate_limit" ? "Слишком много попыток. Попробуйте немного позже."
      : result.status === "conflict" ? "Откройте свою анкету или войдите с нужным email."
        : result.status === "invalid" ? "Проверьте заполненные поля и отправьте ещё раз."
          : result.status === "unavailable" ? "Не удалось завершить регистрацию. Ответы сохранены в этой вкладке. Попробуйте позже." : "";
  return <main className="min-h-dvh bg-bg text-fg" data-testid="public-student-application">
    <header className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-6 sm:px-8">
      <Link href="/apply" aria-label="EVO Admissions — начало анкеты"><EvoLogo width={146} /></Link>
      <Link href={signedInEmail ? "/apply/status" : "/login"} className="inline-flex min-h-11 items-center text-sm font-medium text-fg-2 underline-offset-4 hover:underline">{signedInEmail ? "Моя заявка" : "Уже есть аккаунт? Войти"}</Link>
    </header>
    {result.status === "check_email" ? <section className="mx-auto max-w-xl px-5 py-14 sm:py-24">
      <p className="text-sm font-medium text-accent-text">Последний шаг</p><h1 className="mt-4 text-3xl font-semibold tracking-tight">Подтвердите ваш email</h1>
      <p className="mt-5 text-base leading-7 text-fg-2">Откройте ссылку в письме, чтобы отправить анкету на рассмотрение. Проверьте также папку «Спам».</p>
      <p className="mt-3 text-sm leading-6 text-fg-2">Если аккаунт с этим адресом уже есть, войдите с вашим паролем.</p>
      <Link href="/login" className="mt-8 inline-flex min-h-12 items-center rounded-ctl bg-accent px-6 font-semibold text-on-accent">Перейти ко входу</Link>
    </section> : <div className="mx-auto max-w-4xl px-4 pb-10 pt-3 sm:px-8 sm:pt-8">
      <div className="mb-6 flex items-center justify-between gap-4 text-sm"><span className="font-medium text-fg-2">{STEPS[step]}</span><span aria-live="polite" className="text-fg-2">Шаг {step + 1} из 9</span></div>
      <div role="progressbar" aria-label="Заполнение анкеты" aria-valuemin={0} aria-valuemax={9} aria-valuenow={step + 1} className="mb-8 flex gap-1.5">{STEPS.map((label, i) => <span key={label} className={`h-1.5 flex-1 rounded-full transition-colors ${i <= step ? "bg-accent" : "bg-border"}`} />)}</div>
      <form ref={form} action={action} onSubmit={submit} className="rounded-card border border-border bg-surface px-5 pb-5 pt-7 sm:px-10 sm:pb-8 sm:pt-10">
        <input name="questionnaire" type="hidden" value={JSON.stringify(questionnaire(values))} />
        <input name="expected_revision" type="hidden" value={expectedRevision} />
        {step !== 8 && <><input name="email" type="hidden" value={signedInEmail ?? ""} /><input name="password" type="hidden" value="" /></>}
        <div key={step} className="page-in min-h-[340px] motion-reduce:animate-none">
          <h1 tabIndex={-1} ref={heading} className="max-w-xl text-2xl font-semibold leading-tight tracking-tight outline-none sm:text-3xl">{step === 8 && signedInEmail ? "Проверьте контактные данные" : QUESTIONS[step]}</h1>
          {stepCopy && <p className="mt-3 text-sm leading-6 text-fg-2">{stepCopy}</p>}
          <div className="mt-7 space-y-5">
            {step === 0 && <div className="grid gap-3 sm:grid-cols-3">{STUDENT_APPLICATION_COUNTRIES.map((country) => <Choice key={country} selected={values.destinationCountries.includes(country)} onClick={() => toggle("destinationCountries", country)}><span className="flex items-center gap-3"><span aria-hidden="true" className="text-2xl">{String.fromCodePoint(...[...country].map((c) => c.charCodeAt(0) + 127397))}</span>{LABELS[country]}</span></Choice>)}</div>}
            {step === 1 && <div className="grid max-w-xl gap-5 sm:grid-cols-2">{select("intakeSeason", "Набор", STUDENT_APPLICATION_INTAKE_SEASONS)}<label className="grid gap-2 text-sm font-medium text-fg-2">Год<select className={INPUT} required value={values.intakeYear} onChange={(e) => update("intakeYear", e.target.value)}><option value="">Выберите год</option>{years.map((y) => <option key={y} value={y}>{y}</option>)}</select></label></div>}
            {step === 2 && <div className="max-w-xl space-y-5">{select("educationLevel", "Текущий или последний уровень образования", STUDENT_APPLICATION_EDUCATION_LEVELS)}<div className="grid gap-5 sm:grid-cols-2"><label className="grid gap-2 text-sm font-medium text-fg-2">Средний балл<input className={INPUT} type="number" min="0" max={Number(values.gradeScale)} step="0.01" required value={values.averageGrade} onChange={(e) => update("averageGrade", e.target.value)} inputMode="decimal" /></label><label className="grid gap-2 text-sm font-medium text-fg-2">Шкала оценивания<select className={INPUT} value={values.gradeScale} onChange={(e) => update("gradeScale", e.target.value)}>{STUDENT_APPLICATION_GRADE_SCALES.map((scale) => <option key={scale} value={scale}>Из {scale}</option>)}</select></label></div></div>}
            {step === 3 && <><label className="grid gap-2 text-sm font-medium text-fg-2">Найти направление<input className={INPUT} value={fieldSearch} onChange={(e) => setFieldSearch(e.target.value)} placeholder="Например, инженерия" type="search" /></label><div className="grid gap-3 sm:grid-cols-2">{STUDY_FIELD_OPTIONS.filter((item) => item.toLocaleLowerCase("ru").includes(fieldSearch.toLocaleLowerCase("ru"))).map((field) => <Choice key={field} selected={values.studyFields.includes(field)} onClick={() => toggle("studyFields", field)}>{field}</Choice>)}</div><div className="flex flex-wrap gap-2">{values.studyFields.filter((s) => !(STUDY_FIELD_OPTIONS as readonly string[]).includes(s)).map((s) => <button type="button" key={s} onClick={() => toggle("studyFields", s)} className="min-h-11 rounded-ctl border border-accent bg-accent-weak px-3 text-sm text-accent-text" aria-label={`Убрать ${s}`}>{s} ×</button>)}</div><div className="flex items-end gap-3"><label className="grid min-w-0 flex-1 gap-2 text-sm font-medium text-fg-2">Своё направление<input className={INPUT} maxLength={100} value={customField} onChange={(e) => setCustomField(e.target.value)} /></label><button type="button" disabled={!customField.trim()} onClick={() => { const field = customField.trim(); if (field && !values.studyFields.includes(field)) toggle("studyFields", field); setCustomField(""); }} className="min-h-12 rounded-ctl border border-control-edge px-4 text-sm font-medium disabled:opacity-50">Добавить</button></div></>}
            {step === 4 && <div className="grid gap-3 sm:grid-cols-2">{STUDENT_APPLICATION_STUDY_LEVELS.map((level) => <Choice key={level} selected={values.studyLevels.includes(level)} onClick={() => toggle("studyLevels", level)}>{LABELS[level]}</Choice>)}</div>}
            {step === 5 && <label className="grid max-w-xl gap-2 text-sm font-medium text-fg-2">Страна гражданства<select required className={INPUT} value={values.nationality} onChange={(e) => update("nationality", e.target.value)}><option value="">Выберите страну</option>{NATIONALITY_COUNTRIES.map((code) => ({ code, name: countryLabel(code) })).sort((a, b) => a.name.localeCompare(b.name, "ru")).map(({ code, name }) => <option key={code} value={code}>{name}</option>)}</select></label>}
            {step === 6 && <div className="max-w-xl space-y-6"><fieldset><legend className="mb-3 text-sm font-medium text-fg-2">Есть результат языкового экзамена?</legend><div className="grid gap-3 sm:grid-cols-2"><Choice selected={values.englishMode === "exam"} onClick={() => update("englishMode", "exam")}>Да, есть результат</Choice><Choice selected={values.englishMode === "self"} onClick={() => update("englishMode", "self")}>Нет, пока не сдавал</Choice></div></fieldset>{values.englishMode === "exam" && <div className="grid gap-5 sm:grid-cols-2">{select("englishExam", "Экзамен и шкала", Object.keys(ENGLISH_EXAMS))}<label className="grid gap-2 text-sm font-medium text-fg-2">Общий результат<input required className={INPUT} type="number" min={exam.min} max={exam.max} step={exam.step} value={values.englishScore} onChange={(e) => update("englishScore", e.target.value)} inputMode="decimal" /></label></div>}{values.englishMode === "self" && select("englishLevel", "Как вы оцениваете свой английский?", ["beginner", "intermediate", "advanced", "fluent"])}</div>}
            {step === 7 && <div className="max-w-xl space-y-5">{select("tuitionBudget", "Обучение в год, USD", STUDENT_APPLICATION_TUITION_BUDGETS)}{select("fundingSource", "Источник финансирования", STUDENT_APPLICATION_FUNDING_SOURCES)}</div>}
            {step === 8 && <div className="space-y-5"><div className="grid gap-5 sm:grid-cols-2"><label className="grid gap-2 text-sm font-medium text-fg-2">Имя<input required className={INPUT} autoComplete="given-name" maxLength={60} value={values.firstName} onChange={(e) => update("firstName", e.target.value)} /></label><label className="grid gap-2 text-sm font-medium text-fg-2">Фамилия<input required className={INPUT} autoComplete="family-name" maxLength={60} value={values.lastName} onChange={(e) => update("lastName", e.target.value)} /></label><label className="grid gap-2 text-sm font-medium text-fg-2">Телефон с кодом страны<input required className={INPUT} type="tel" autoComplete="tel" maxLength={40} placeholder="+996 …" value={values.phone} onChange={(e) => update("phone", e.target.value)} /></label><label className="grid gap-2 text-sm font-medium text-fg-2">Email<input required className={INPUT} name="email" type="email" autoComplete="email" maxLength={254} defaultValue={signedInEmail ?? ""} readOnly={Boolean(signedInEmail)} /></label></div>{signedInEmail ? <input name="password" type="hidden" value="" /> : <label className="grid max-w-xl gap-2 text-sm font-medium text-fg-2">Пароль<div className="flex gap-2"><input required className={INPUT} name="password" type={showPassword ? "text" : "password"} autoComplete="new-password" minLength={12} maxLength={128} aria-describedby="password-hint" /><button type="button" aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)} className="min-h-12 rounded-ctl px-2 text-sm text-accent-text">{showPassword ? "Скрыть" : "Показать"}</button></div><span id="password-hint" className="text-sm font-normal text-fg-2">Не менее 12 символов.</span></label>}<label className="flex cursor-pointer items-start gap-3 border-t border-border pt-5 text-sm leading-6 text-fg-2"><input type="checkbox" required checked={values.consent} onChange={(e) => update("consent", e.target.checked)} className="mt-1 size-5 shrink-0 accent-accent" /><span>Согласен передать анкету команде EVO для рассмотрения заявки и связи со мной по вопросам поступления.</span></label></div>}
          </div>
        </div>
        {(error || serverError) && <p role="alert" className="mt-6 rounded-ctl bg-danger-weak p-3 text-sm leading-6 text-danger">{error || serverError}</p>}
        <footer className="mt-8 flex items-center justify-between gap-3 border-t border-border pt-5">
          <button type="button" disabled={step === 0 || pending} onClick={() => changeStep(step - 1)} className="min-h-12 rounded-ctl px-4 font-medium text-fg-2 hover:bg-surface-2 disabled:invisible">Назад</button>
          <button type="submit" disabled={pending || !loaded} className="min-h-12 rounded-ctl bg-accent px-6 font-semibold text-on-accent transition-colors hover:bg-accent-2 disabled:opacity-60">{pending ? "Сохраняем…" : step === 8 ? signedInEmail ? "Отправить анкету" : "Создать аккаунт" : "Продолжить"}</button>
        </footer>
      </form>
      <p className="mt-5 text-center text-xs leading-5 text-fg-2">{signedInEmail ? "Данные будут сохранены в вашей заявке." : "Черновик сохраняется в этой вкладке. После регистрации анкета будет доступна в аккаунте."}</p>
    </div>}
  </main>;
}
