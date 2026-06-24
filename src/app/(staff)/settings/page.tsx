import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { getSetting } from "@/lib/db";
import { checkAmoCrmAction, getIntegrationStatus, saveSettingsAction } from "@/lib/actions";
import { Card, inputCls, btnCls } from "@/components/ui";

function masked(value: string | null): string {
  if (!value) return "";
  return value.length > 8 ? `${value.slice(0, 4)}…${value.slice(-4)}` : "••••";
}

export default async function SettingsPage() {
  const user = await currentUser();
  if (!user || user.role !== "admin") redirect("/dashboard");
  const { t } = await getT();
  const integrations = await getIntegrationStatus();

  const fields = {
    wa_token: getSetting("wa_token"),
    wa_phone_id: getSetting("wa_phone_id"),
    wa_verify_token: getSetting("wa_verify_token"),
    tel_provider: getSetting("tel_provider"),
    tel_api_key: getSetting("tel_api_key"),
    anthropic_api_key: getSetting("anthropic_api_key"),
    amocrm_account_base_url: getSetting("amocrm_account_base_url"),
    amocrm_client_id: getSetting("amocrm_client_id"),
    amocrm_client_secret: getSetting("amocrm_client_secret"),
    amocrm_redirect_uri: getSetting("amocrm_redirect_uri"),
    amocrm_refresh_token: getSetting("amocrm_refresh_token"),
    amocrm_pipeline_id: getSetting("amocrm_pipeline_id"),
    amocrm_status_id: getSetting("amocrm_status_id"),
    amocrm_responsible_user_id: getSetting("amocrm_responsible_user_id"),
    amocrm_target_country_field_id: getSetting("amocrm_target_country_field_id"),
    amocrm_source_field_id: getSetting("amocrm_source_field_id"),
    amocrm_last_check: getSetting("amocrm_last_check"),
  };
  const amoStatus = integrations.amocrm;
  const amoStatusText = amoStatus.status === "not_configured"
    ? `${t("amocrmNotConfigured")}: ${amoStatus.missing.join(", ")}`
    : amoStatus.status === "blocked"
      ? `${t("amocrmBlocked")}: ${amoStatus.reason}`
      : `${t("amocrmConfigured")}: ${amoStatus.accountBaseUrl}`;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">⚙️ {t("integrationSettings")}</h1>
        <p className="mt-1 text-sm text-slate-500">{t("adminOnly")}</p>
      </div>

      <form action={saveSettingsAction} className="space-y-6">
        <Card title={`💬 ${t("waSection")}`}>
          <div className="space-y-3">
            <label className="block text-xs font-medium text-slate-500">
              {t("waToken")}
              <input name="wa_token" defaultValue={fields.wa_token ?? ""} placeholder="EAAG…" className={`${inputCls} mt-1`} />
            </label>
            <label className="block text-xs font-medium text-slate-500">
              {t("waPhoneId")}
              <input name="wa_phone_id" defaultValue={fields.wa_phone_id ?? ""} placeholder="1234567890" className={`${inputCls} mt-1`} />
            </label>
            <label className="block text-xs font-medium text-slate-500">
              {t("waVerifyToken")}
              <input name="wa_verify_token" defaultValue={fields.wa_verify_token ?? ""} className={`${inputCls} mt-1`} />
            </label>
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
              {t("webhookUrl")}: <code className="text-indigo-700">https://ваш-домен/api/webhooks/whatsapp</code>
            </p>
          </div>
        </Card>

        <Card title={`📞 ${t("telSection")}`}>
          <div className="space-y-3">
            <label className="block text-xs font-medium text-slate-500">
              {t("telProvider")}
              <select name="tel_provider" defaultValue={fields.tel_provider ?? ""} className={`${inputCls} mt-1`}>
                <option value="">—</option>
                <option value="sipuni">Sipuni</option>
                <option value="zadarma">Zadarma</option>
                <option value="mango">Mango Office</option>
                <option value="other">Другая АТС</option>
              </select>
            </label>
            <label className="block text-xs font-medium text-slate-500">
              {t("telApiKey")}
              <input name="tel_api_key" defaultValue={fields.tel_api_key ?? ""} className={`${inputCls} mt-1`} />
            </label>
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
              {t("telWebhookHint")}<br />
              <code className="text-indigo-700">https://ваш-домен/api/webhooks/telephony</code>
            </p>
          </div>
        </Card>

        <Card title={`✨ ${t("aiSection")}`}>
          <label className="block text-xs font-medium text-slate-500">
            {t("aiApiKey")}
            <input
              name="anthropic_api_key"
              defaultValue={fields.anthropic_api_key ?? ""}
              placeholder={fields.anthropic_api_key ? masked(fields.anthropic_api_key) : "sk-ant-…"}
              className={`${inputCls} mt-1`}
            />
          </label>
          <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
            console.anthropic.com → API Keys
          </p>
        </Card>

        <Card title={t("amocrmSection")}>
          <div className="space-y-4">
            <p
              className={`rounded-lg px-3 py-2 text-xs ${
                amoStatus.status === "configured"
                  ? "bg-blue-50 text-blue-800"
                  : amoStatus.status === "blocked"
                    ? "bg-red-50 text-red-700"
                    : "bg-amber-50 text-amber-800"
              }`}
            >
              {amoStatusText}
            </p>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-xs font-medium text-slate-500">
                {t("amocrmAccount")}
                <input
                  name="amocrm_account_base_url"
                  defaultValue={fields.amocrm_account_base_url ?? ""}
                  placeholder="evoadmissions.amocrm.ru"
                  className={`${inputCls} mt-1`}
                />
              </label>
              <label className="block text-xs font-medium text-slate-500">
                {t("amocrmClientId")}
                <input
                  name="amocrm_client_id"
                  defaultValue={fields.amocrm_client_id ?? ""}
                  className={`${inputCls} mt-1`}
                />
              </label>
              <label className="block text-xs font-medium text-slate-500">
                {t("amocrmClientSecret")}
                <input
                  name="amocrm_client_secret"
                  type="password"
                  placeholder={fields.amocrm_client_secret ? masked(fields.amocrm_client_secret) : ""}
                  className={`${inputCls} mt-1`}
                />
              </label>
              <label className="block text-xs font-medium text-slate-500">
                {t("amocrmRefreshToken")}
                <input
                  name="amocrm_refresh_token"
                  type="password"
                  placeholder={fields.amocrm_refresh_token ? masked(fields.amocrm_refresh_token) : ""}
                  className={`${inputCls} mt-1`}
                />
              </label>
              <label className="block text-xs font-medium text-slate-500 sm:col-span-2">
                {t("amocrmRedirectUri")}
                <input
                  name="amocrm_redirect_uri"
                  defaultValue={fields.amocrm_redirect_uri ?? ""}
                  placeholder="https://your-domain.example/amocrm/oauth/callback"
                  className={`${inputCls} mt-1`}
                />
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-xs font-medium text-slate-500">
                {t("amocrmPipelineId")}
                <input name="amocrm_pipeline_id" inputMode="numeric" defaultValue={fields.amocrm_pipeline_id ?? ""} className={`${inputCls} mt-1`} />
              </label>
              <label className="block text-xs font-medium text-slate-500">
                {t("amocrmStatusId")}
                <input name="amocrm_status_id" inputMode="numeric" defaultValue={fields.amocrm_status_id ?? ""} className={`${inputCls} mt-1`} />
              </label>
              <label className="block text-xs font-medium text-slate-500">
                {t("amocrmResponsibleUserId")}
                <input name="amocrm_responsible_user_id" inputMode="numeric" defaultValue={fields.amocrm_responsible_user_id ?? ""} className={`${inputCls} mt-1`} />
              </label>
              <label className="block text-xs font-medium text-slate-500">
                {t("amocrmCountryFieldId")}
                <input name="amocrm_target_country_field_id" inputMode="numeric" defaultValue={fields.amocrm_target_country_field_id ?? ""} className={`${inputCls} mt-1`} />
              </label>
              <label className="block text-xs font-medium text-slate-500">
                {t("amocrmSourceFieldId")}
                <input name="amocrm_source_field_id" inputMode="numeric" defaultValue={fields.amocrm_source_field_id ?? ""} className={`${inputCls} mt-1`} />
              </label>
            </div>

            <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
              {t("amocrmCheckHint")}
              {fields.amocrm_last_check ? <><br /><code className="text-slate-700">{fields.amocrm_last_check}</code></> : null}
            </p>
          </div>
        </Card>

        <button type="submit" className={btnCls}>{t("save")}</button>
      </form>

      <form action={checkAmoCrmAction}>
        <button type="submit" className={btnCls}>{t("amocrmCheck")}</button>
      </form>
    </div>
  );
}
