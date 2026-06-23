import { getT } from "@/lib/i18n";
import { LoginForm } from "@/components/AuthForms";
import { LangSwitcher } from "@/components/LangSwitcher";

export default async function LoginPage() {
  const { t, locale } = await getT();
  const labels = Object.fromEntries(
    ["email", "password", "signIn", "noAccount", "invalidCredentials", "fillAllFields"].map((k) => [k, t(k)])
  );
  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <div className="grid w-full max-w-5xl overflow-hidden rounded-lg border border-[var(--evo-border)] bg-white shadow-[var(--evo-shadow-md)] lg:grid-cols-[1fr_420px]">
        <section className="hidden min-h-[540px] bg-[linear-gradient(135deg,#0f172a_0%,#1d4ed8_62%,#0e7490_100%)] p-10 text-white lg:flex lg:flex-col lg:justify-between">
          <div>
            <div className="inline-flex h-10 items-center rounded-md border border-white/20 bg-white/10 px-3 text-sm font-semibold">
              EVO CRM
            </div>
            <h1 className="mt-8 max-w-lg text-4xl font-semibold leading-tight">{t("appName")}</h1>
            <p className="mt-4 max-w-md text-sm leading-6 text-blue-50">
              {t("registerIntro")}
            </p>
          </div>
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div className="rounded-md border border-white/15 bg-white/10 p-3">
              <div className="text-xl font-semibold">CRM</div>
              <div className="mt-1 text-blue-50">{t("clients")}</div>
            </div>
            <div className="rounded-md border border-white/15 bg-white/10 p-3">
              <div className="text-xl font-semibold">AI</div>
              <div className="mt-1 text-blue-50">{t("aiAssistant")}</div>
            </div>
            <div className="rounded-md border border-white/15 bg-white/10 p-3">
              <div className="text-xl font-semibold">WA</div>
              <div className="mt-1 text-blue-50">{t("whatsapp")}</div>
            </div>
          </div>
        </section>

        <section className="p-6 sm:p-8">
          <div className="mb-8 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase text-blue-600">EVO CRM</p>
              <h1 className="mt-1 text-xl font-semibold text-slate-950">{t("login")}</h1>
            </div>
            <LangSwitcher current={locale} />
          </div>
          <LoginForm labels={labels} />
        </section>
      </div>
    </main>
  );
}
