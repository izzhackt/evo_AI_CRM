import type { Metadata } from "next";
import { headers } from "next/headers";

import { LoginForm } from "@/components/AuthForms";
import { EvoLogo } from "@/components/platform/brand/EvoLogo";
import { LangSwitcher } from "@/components/LangSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";
import { getT } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n-data";
import { buildRouteMetadata } from "@/lib/route-metadata";
import {
  platformAudienceForHost,
  PRODUCTION_STAFF_ORIGIN,
  PRODUCTION_STUDENT_ORIGIN,
  type PlatformAudience,
} from "@/lib/platform-public-origin";

const COPY: Record<
  Locale,
  Readonly<{
    accessDenied: string;
    authUnavailable: string;
    staffAccessDenied: string;
    email: string;
    intro: string;
    password: string;
    signIn: string;
    title: string;
  }>
> = {
  ru: {
    accessDenied: "Не удалось войти. Проверьте оба значения.",
    authUnavailable: "Сервис входа временно недоступен.",
    staffAccessDenied: "Аккаунт не имеет активного доступа к продукту EVO.",
    email: "Email или логин",
    intro:
      "Для сотрудников и студентов EVO.",
    password: "Пароль",
    signIn: "Войти в CRM",
    title: "Вход в EVO",
  },
  ky: {
    accessDenied: "Кирүү ишке ашкан жок. Эки маанини тең текшериңиз.",
    authUnavailable: "Кирүү кызматы убактылуу жеткиликсиз.",
    staffAccessDenied: "Аккаунтта EVO продуктусуна активдүү мүмкүнчүлүк жок.",
    email: "Email же логин",
    intro:
      "EVO кызматкерлери жана студенттери үчүн.",
    password: "Сырсөз",
    signIn: "CRMге кирүү",
    title: "EVO'го кирүү",
  },
  en: {
    accessDenied: "Access was not granted. Check both values.",
    authUnavailable: "The sign-in service is temporarily unavailable.",
    staffAccessDenied: "This account has no active access to EVO.",
    email: "Email or login",
    intro:
      "For EVO staff and students.",
    password: "Password",
    signIn: "Sign in to CRM",
    title: "Sign in to EVO",
  },
};

const AUDIENCE_COPY: Record<Locale, Record<PlatformAudience, Readonly<{
  title: string; intro: string; signIn: string; otherSignIn: string;
}>>> = {
  ru: {
    staff: { title: "Вход для сотрудников", intro: "Рабочее пространство EVO.", signIn: "Войти в CRM", otherSignIn: "Кабинет студента" },
    student: { title: "Кабинет студента", intro: "Ваше поступление и документы в EVO.", signIn: "Войти в кабинет", otherSignIn: "Вход для сотрудников" },
  },
  ky: {
    staff: { title: "Кызматкерлер үчүн кирүү", intro: "EVO иш мейкиндиги.", signIn: "CRMге кирүү", otherSignIn: "Студенттин кабинети" },
    student: { title: "Студенттин кабинети", intro: "EVO'догу окууга тапшырууңуз жана документтериңиз.", signIn: "Кабинетке кирүү", otherSignIn: "Кызматкерлер үчүн кирүү" },
  },
  en: {
    staff: { title: "Staff sign-in", intro: "Your EVO workspace.", signIn: "Sign in to CRM", otherSignIn: "Student portal" },
    student: { title: "Student portal", intro: "Your EVO admissions and documents.", signIn: "Sign in to portal", otherSignIn: "Staff sign-in" },
  },
};

export async function generateMetadata(): Promise<Metadata> {
  return buildRouteMetadata({
    ru: COPY.ru.title,
    ky: COPY.ky.title,
    en: COPY.en.title,
  });
}

type LoginPageSearchParams = Promise<{
  error?: string | string[];
}>;

function firstQueryValue(value: string | string[] | undefined): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[0] ?? null;
  return null;
}

export default async function LoginPage({
  searchParams,
}: Readonly<{ searchParams: LoginPageSearchParams }>) {
  const { t, locale } = await getT();
  const audience = platformAudienceForHost((await headers()).get("host"));
  const audienceCopy = audience ? AUDIENCE_COPY[locale][audience] : null;
  const copy = { ...COPY[locale], ...audienceCopy };
  const error = firstQueryValue((await searchParams).error);
  const initialError =
    error === "session_invalid"
      ? "accessDenied"
      : error === "auth_unavailable"
        ? "authUnavailable"
        : error === "staffAccessDenied"
          ? "staffAccessDenied"
          : null;

  return (
    <main className="flex min-h-dvh flex-col bg-bg px-4 py-6 sm:px-6">
      <div className="flex min-h-11 items-center justify-end gap-3">
        <LangSwitcher current={locale} />
        <ThemeToggle label={t("toggleTheme")} />
      </div>

      <div className="flex flex-1 items-center justify-center py-8 sm:py-12">
        <div className="w-full max-w-[420px] rounded-card border border-border bg-surface p-6 sm:p-8">
          <div data-theme="light" className="mb-6 w-fit rounded-ctl bg-surface p-4">
            <EvoLogo width={156} />
          </div>
          <h1 id="login-title" className="text-2xl font-semibold leading-tight tracking-[-0.02em] text-fg">
            {copy.title}
          </h1>
          <p className="mt-2 text-sm leading-6 text-fg-2">{copy.intro}</p>
          <div className="mt-6">
            <LoginForm labels={copy} initialError={initialError} />
          </div>
          {audience !== "staff" && <a href="/apply" className="mt-5 flex min-h-11 items-center justify-center rounded-ctl border border-control-edge px-4 text-sm font-semibold text-fg">{locale === "en" ? "Create a student account" : locale === "ky" ? "Студенттик аккаунт түзүү" : "Создать аккаунт студента"}</a>}
          {audienceCopy && (
            <a
              href={`${audience === "staff" ? PRODUCTION_STUDENT_ORIGIN : PRODUCTION_STAFF_ORIGIN}/login`}
              className="mt-4 inline-flex min-h-11 items-center text-sm text-fg-2 underline underline-offset-4"
            >
              {audienceCopy.otherSignIn}
            </a>
          )}
        </div>
      </div>
    </main>
  );
}
