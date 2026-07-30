import Link from "next/link";
import { getT } from "@/lib/i18n";
import { RegisterForm } from "@/components/AuthForms";
import { LangSwitcher } from "@/components/LangSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";
import { btnGhostCls } from "@/components/ui";
import { isUiContractFixtureMode } from "@/lib/runtime-mode";

export default async function RegisterPage() {
  const { t, locale } = await getT();
  const fixtureMode = isUiContractFixtureMode();
  const labels = Object.fromEntries(
    ["name", "email", "phone", "password", "signUp", "haveAccount", "emailTaken", "invitationRequired", "fillAllFields"].map((k) => [k, t(k)])
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
        <h1 className="text-[22px] font-bold leading-tight text-fg">
          {fixtureMode ? t("register") : t("inviteOnlyTitle")}
        </h1>
        <p className="mt-1.5 text-[13px] leading-6 text-fg-3">
          {fixtureMode ? t("registerIntro") : t("inviteOnlyHint")}
        </p>
        <div className="mt-6">
          {fixtureMode ? (
            <RegisterForm labels={labels} />
          ) : (
            <Link
              href="/login"
              className={`${btnGhostCls} flex w-full items-center justify-center`}
            >
              {t("backToLogin")}
            </Link>
          )}
        </div>
      </div>
    </main>
  );
}
