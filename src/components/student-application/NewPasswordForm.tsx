"use client";

import { useActionState, useState } from "react";

import { btnCls, cn, fieldLabelCls, inputCls } from "@/components/ui";
import type { Locale } from "@/lib/i18n-data";
import { AI_CONSENT_PRIVACY_URL } from "@/lib/portal/ai-consent";
import { getPortalStrings } from "@/lib/portal/i18n";
import { STUDENT_APPLICATION_CONSENT_VERSION } from "@/lib/student-application-contract";
import { setOwnStudentPasswordAction, type StudentNewPasswordState } from "@/lib/student-new-password-actions";

const STRINGS = {
  ru: {
    title: "Придумайте свой пароль",
    text: "Вы вошли с временным паролем. Придумайте свой — дальше входите с ним.",
    password: "Новый пароль",
    confirm: "Повторите пароль",
    hint: "Не короче 12 знаков.",
    submit: "Сохранить пароль",
    pending: "Сохраняем…",
    too_short: "Пароль короче 12 знаков.",
    too_long: "Пароль слишком длинный.",
    mismatch: "Пароли не совпадают.",
    privacyBefore: "Принимаю ",
    privacyLink: "Политику конфиденциальности",
    privacyAfter: " EVO.",
    consent_required: "Отметьте обе галочки.",
    rejected: "Этот пароль не подходит. Придумайте другой.",
    unavailable: "Не удалось сохранить пароль. Попробуйте ещё раз.",
  },
  ky: {
    title: "Өз сырсөзүңүздү ойлоп табыңыз",
    text: "Сиз убактылуу сырсөз менен кирдиңиз. Өзүңүздүкүн ойлоп табыңыз — мындан ары аны менен кириңиз.",
    password: "Жаңы сырсөз",
    confirm: "Сырсөздү кайталаңыз",
    hint: "12 белгиден кем эмес.",
    submit: "Сырсөздү сактоо",
    pending: "Сакталууда…",
    too_short: "Сырсөз 12 белгиден кыска.",
    too_long: "Сырсөз өтө узун.",
    mismatch: "Сырсөздөр дал келбейт.",
    privacyBefore: "EVO ",
    privacyLink: "купуялык саясатын",
    privacyAfter: " кабыл алам.",
    consent_required: "Эки белгини тең коюңуз.",
    rejected: "Бул сырсөз туура келбейт. Башкасын ойлоп табыңыз.",
    unavailable: "Сырсөз сакталган жок. Кайра аракет кылыңыз.",
  },
} as const;

/**
 * 342: первый вход с временным паролем от администратора — сначала свой пароль. 09.11.2026: здесь же две обязательные
 * галочки регистрации (Политика конфиденциальности и ИИ-помощники): кабинет от администратора анкету не проходит.
 */
export function NewPasswordForm({ locale }: Readonly<{ locale: Locale }>) {
  const strings = locale === "ky" ? STRINGS.ky : STRINGS.ru;
  const aiConsentLabel = getPortalStrings("apply", locale).aiConsentLabel;
  const [privacy, setPrivacy] = useState(false);
  const [aiConsent, setAiConsent] = useState(false);
  const [state, action, pending] = useActionState(setOwnStudentPasswordAction, { status: "idle" } as StudentNewPasswordState);
  const message = state.status === "idle" ? null : strings[state.status];
  return (
    <section aria-labelledby="new-password-title" className="rounded-card border border-border bg-surface px-5 py-6 sm:px-10" data-testid="student-new-password">
      <h1 id="new-password-title" className="mb-2 text-2xl font-semibold text-fg">{strings.title}</h1>
      <p className="mb-5 text-fg-2">{strings.text}</p>
      <form action={action} className="space-y-4">
        <label className="block">
          <span className={fieldLabelCls}>{strings.password}</span>
          <input name="password" type="password" autoComplete="new-password" required minLength={12} aria-describedby="new-password-hint"
            className={cn(inputCls, "min-h-11 w-full")} />
        </label>
        <p id="new-password-hint" className="text-sm text-fg-2">{strings.hint}</p>
        <label className="block">
          <span className={fieldLabelCls}>{strings.confirm}</span>
          <input name="password_confirm" type="password" autoComplete="new-password" required minLength={12}
            className={cn(inputCls, "min-h-11 w-full")} />
        </label>
        <label className="flex cursor-pointer items-start gap-3 border-t border-border pt-4 text-sm leading-6 text-fg-2">
          <input type="checkbox" required checked={privacy} onChange={(event) => setPrivacy(event.target.checked)} className="mt-1 size-5 shrink-0 accent-accent" />
          <span>{strings.privacyBefore}<a href={AI_CONSENT_PRIVACY_URL} target="_blank" rel="noopener noreferrer"
            className="font-medium text-accent-text underline underline-offset-4">{strings.privacyLink}</a>{strings.privacyAfter}</span>
        </label>
        <label className="flex cursor-pointer items-start gap-3 text-sm leading-6 text-fg-2">
          <input type="checkbox" required checked={aiConsent} onChange={(event) => setAiConsent(event.target.checked)} className="mt-1 size-5 shrink-0 accent-accent" />
          <span>{aiConsentLabel}</span>
        </label>
        <input name="privacy_consent" type="hidden" value={privacy ? STUDENT_APPLICATION_CONSENT_VERSION : ""} />
        <input name="ai_consent" type="hidden" value={aiConsent ? "granted" : ""} />
        {message ? <p role="alert" className="text-sm text-danger">{message}</p> : null}
        <button type="submit" disabled={pending} className={cn(btnCls, "min-h-11")}>
          {pending ? strings.pending : strings.submit}
        </button>
      </form>
    </section>
  );
}
