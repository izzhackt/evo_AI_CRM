import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { getSetting } from "@/lib/db";
import { saveSettingsAction } from "@/lib/actions";
import { Card, inputCls, btnCls } from "@/components/ui";

function masked(value: string | null): string {
  if (!value) return "";
  return value.length > 8 ? `${value.slice(0, 4)}…${value.slice(-4)}` : "••••";
}

export default async function SettingsPage() {
  const user = await currentUser();
  if (!user || user.role !== "admin") redirect("/dashboard");
  const { t } = await getT();

  const fields = {
    wa_token: getSetting("wa_token"),
    wa_phone_id: getSetting("wa_phone_id"),
    wa_verify_token: getSetting("wa_verify_token"),
    tel_provider: getSetting("tel_provider"),
    tel_api_key: getSetting("tel_api_key"),
    anthropic_api_key: getSetting("anthropic_api_key"),
  };

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

        <button type="submit" className={btnCls}>{t("save")}</button>
      </form>
    </div>
  );
}
