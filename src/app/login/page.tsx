import { getT } from "@/lib/i18n";
import { LoginForm } from "@/components/AuthForms";
import { LangSwitcher } from "@/components/LangSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";

export default async function LoginPage() {
  const { t, locale } = await getT();
  const labels = Object.fromEntries(
    ["email", "password", "signIn", "noAccount", "invalidCredentials", "fillAllFields"].map((k) => [k, t(k)])
  );
  return (
    <main className="relative grid min-h-dvh place-items-center bg-bg px-4 py-10">
      <div className="absolute left-5 top-5 flex items-center gap-2.5">
        <span className="grid h-[34px] w-[34px] place-items-center rounded-[9px] bg-accent text-[16px] font-bold text-on-accent">E</span>
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
        <h1 id="login-title" className="text-[22px] font-bold leading-tight text-fg">{t("login")}</h1>
        <p className="mt-1.5 text-[13px] leading-6 text-fg-3">{t("commandCenterHint")}</p>
        <div className="mt-6">
          <LoginForm labels={labels} />
        </div>
      </div>
    </main>
  );
}
