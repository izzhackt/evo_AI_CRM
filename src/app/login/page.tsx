import type { Metadata } from "next";

import { LoginForm } from "@/components/AuthForms";
import { EvoIsometricField } from "@/components/platform/brand/EvoIsometricField";
import { EvoMark } from "@/components/platform/brand/EvoMark";
import { LangSwitcher } from "@/components/LangSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";
import { getT } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n-data";
import { buildRouteMetadata } from "@/lib/route-metadata";

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
    staffAccessDenied: "Аккаунт не имеет активного доступа сотрудника EVO.",
    email: "Рабочий email",
    intro:
      "Единый защищённый вход сотрудников EVO через Supabase Auth.",
    password: "Пароль",
    signIn: "Войти в CRM",
    title: "Вход в EVO Admissions CRM",
  },
  ky: {
    accessDenied: "Кирүү ишке ашкан жок. Эки маанини тең текшериңиз.",
    authUnavailable: "Кирүү кызматы убактылуу жеткиликсиз.",
    staffAccessDenied: "Аккаунтта EVO кызматкеринин активдүү мүмкүнчүлүгү жок.",
    email: "Жумуш email",
    intro:
      "EVO кызматкерлери үчүн Supabase Auth аркылуу бирдиктүү корголгон кирүү.",
    password: "Сырсөз",
    signIn: "CRMге кирүү",
    title: "EVO Admissions CRMге кирүү",
  },
  en: {
    accessDenied: "Access was not granted. Check both values.",
    authUnavailable: "The sign-in service is temporarily unavailable.",
    staffAccessDenied: "This account has no active EVO staff access.",
    email: "Work email",
    intro:
      "One protected EVO staff sign-in backed by Supabase Auth.",
    password: "Password",
    signIn: "Sign in to CRM",
    title: "Sign in to EVO Admissions CRM",
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
  const copy = COPY[locale];
  const error = firstQueryValue((await searchParams).error);
  const initialError =
    error === "session_invalid"
      ? "accessDenied"
      : error === "auth_unavailable"
        ? "authUnavailable"
        : null;

  return (
    <main className="relative grid min-h-dvh place-items-center bg-bg px-4 py-10">
      <EvoIsometricField />
      <div className="absolute left-5 top-5 flex items-center gap-2.5">
        <EvoMark size={34} />
        <span className="leading-tight">
          <span className="block text-md font-bold text-fg">EVO</span>
          <span className="block text-xs text-fg-3">Admissions CRM</span>
        </span>
      </div>
      <div className="absolute right-5 top-5 flex items-center gap-2.5">
        <LangSwitcher current={locale} />
        <ThemeToggle label={t("toggleTheme")} />
      </div>

      <div className="page-in w-full max-w-[392px] rounded-[20px] bg-surface p-7 shadow-evo-lg">
        <h1 id="login-title" className="text-2xl font-bold leading-tight text-fg">
          {copy.title}
        </h1>
        <p className="mt-1.5 max-w-[56ch] text-sm leading-6 text-fg-3">{copy.intro}</p>
        <div className="mt-6">
          <LoginForm labels={copy} initialError={initialError} />
        </div>
      </div>
    </main>
  );
}
