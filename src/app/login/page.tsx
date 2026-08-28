import { LoginForm } from "@/components/AuthForms";
import { LangSwitcher } from "@/components/LangSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";
import { getT } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n-data";

const COPY: Record<
  Locale,
  Readonly<{
    accessDenied: string;
    gateUnavailable: string;
    identifier: string;
    intro: string;
    secret: string;
    signIn: string;
    title: string;
  }>
> = {
  ru: {
    accessDenied: "Не удалось войти. Проверьте оба значения.",
    gateUnavailable: "Локальный доступ не настроен.",
    identifier: "Идентификатор",
    intro:
      "Закрытый локальный вход для проверки CRM. Это не аккаунт сотрудника и не production-аутентификация.",
    secret: "Секрет",
    signIn: "Открыть CRM",
    title: "Доступ к EVO V2",
  },
  ky: {
    accessDenied: "Кирүү ишке ашкан жок. Эки маанини тең текшериңиз.",
    gateUnavailable: "Жергиликтүү кирүү жөндөлгөн эмес.",
    identifier: "Идентификатор",
    intro:
      "CRM текшерүү үчүн жабык жергиликтүү кирүү. Бул кызматкердин аккаунту же production-аутентификация эмес.",
    secret: "Сыр",
    signIn: "CRM ачуу",
    title: "EVO V2 кирүү",
  },
  en: {
    accessDenied: "Access was not granted. Check both values.",
    gateUnavailable: "Local development access is not configured.",
    identifier: "Identifier",
    intro:
      "Private local access for CRM validation. This is not a staff account or production authentication.",
    secret: "Secret",
    signIn: "Open CRM",
    title: "EVO V2 access",
  },
};

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
      : error === "gate_unavailable"
        ? "gateUnavailable"
        : null;

  return (
    <main className="relative grid min-h-dvh place-items-center bg-bg px-4 py-10">
      <div className="absolute left-5 top-5 flex items-center gap-2.5">
        <span className="grid h-[34px] w-[34px] place-items-center rounded-[9px] bg-accent text-[16px] font-bold text-on-accent">
          E
        </span>
        <span className="leading-tight">
          <span className="block text-[15px] font-bold text-fg">EVO</span>
          <span className="block text-[11px] text-fg-3">Admissions CRM</span>
        </span>
      </div>
      <div className="absolute right-5 top-5 flex items-center gap-2.5">
        <LangSwitcher current={locale} />
        <ThemeToggle label={t("toggleTheme")} />
      </div>

      <div className="page-in w-full max-w-[392px] rounded-[20px] border border-border bg-surface p-7 shadow-evo-lg">
        <h1 id="login-title" className="text-[22px] font-bold leading-tight text-fg">
          {copy.title}
        </h1>
        <p className="mt-1.5 text-[13px] leading-6 text-fg-3">{copy.intro}</p>
        <div className="mt-6">
          <LoginForm labels={copy} initialError={initialError} />
        </div>
      </div>
    </main>
  );
}
