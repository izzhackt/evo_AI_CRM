import Link from "next/link";

import { getT } from "@/lib/i18n";
import { getSetting } from "@/lib/db";
import { checkAmoCrmAction, getIntegrationStatus, saveSettingsAction } from "@/lib/actions";
import { requireStaffRoute } from "@/lib/guards";
import { PageHeader, inputCls, btnCls, btnGhostCls, labelCls, cn, EmptyState } from "@/components/ui";
import { Icon, type IconName } from "@/components/icons";
import { ContextBanner, QueueMetrics } from "@/components/platform/operations/OperationsPrimitives";
import { STAFF_NAV_ITEMS, STAFF_ROLES } from "@/lib/domain";
import { listOperationalAuditTrail, listStaff } from "@/lib/queries";

function masked(value: string | null): string {
  if (!value) return "";
  return value.length > 8 ? `${value.slice(0, 4)}…${value.slice(-4)}` : "••••";
}

const PILL_TONE: Record<"ok" | "warn" | "info", string> = {
  ok: "bg-ok-weak text-ok",
  warn: "bg-warn-weak text-warn",
  info: "bg-info-weak text-info",
};

function StatusPill({ tone, label }: { tone: "ok" | "warn" | "info"; label: string }) {
  return (
    <span className={cn("inline-flex min-h-6 items-center rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold", PILL_TONE[tone])}>
      {label}
    </span>
  );
}

function noteCls() {
  return "rounded-ctl bg-surface-2 px-3 py-2.5 text-[12px] text-fg-3";
}

type SettingsTab = "overview" | "users" | "roles" | "integrations" | "audit";

const SETTINGS_TABS: SettingsTab[] = ["overview", "users", "roles", "integrations", "audit"];

export async function renderLegacySettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  await requireStaffRoute("/settings");
  const { t } = await getT();
  const params = await searchParams;
  const tab: SettingsTab = SETTINGS_TABS.includes(params.tab as SettingsTab)
    ? (params.tab as SettingsTab)
    : "integrations";
  const integrations = await getIntegrationStatus();
  const staff = listStaff();
  const audit = listOperationalAuditTrail();

  const fields = {
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
  const amoPill: { tone: "ok" | "warn" | "info"; label: string } =
    amoStatus.status === "configured"
      ? { tone: "info", label: t("configuredNotVerified") }
      : amoStatus.status === "blocked"
        ? { tone: "warn", label: t("amocrmBlocked") }
        : { tone: "warn", label: t("statusNotConfigured") };
  const platformWahaPill: { tone: "ok" | "warn" | "info"; label: string } = {
    tone: "info",
    label: t("serverEnforced"),
  };

  const header = (icon: IconName, title: string, pill: { tone: "ok" | "warn" | "info"; label: string }) => (
    <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
      <div className="flex items-center gap-2.5">
        <span className="grid h-8 w-8 place-items-center rounded-nav bg-surface-2 text-fg-2"><Icon name={icon} size={16} /></span>
        <h2 className="text-[14.5px] font-semibold text-fg">{title}</h2>
      </div>
      <StatusPill tone={pill.tone} label={pill.label} />
    </header>
  );

  return (
    <div className="mx-auto max-w-[1120px] space-y-5" data-testid="settings-page">
      <PageHeader
        title={t("adminWorkspace")}
        description={t("adminWorkspaceHint")}
      />

      <nav
        aria-label={t("adminWorkspace")}
        className="flex max-w-full gap-1 overflow-x-auto rounded-card border border-border bg-surface p-1 shadow-evo"
      >
        {SETTINGS_TABS.map((item) => {
          const label = t(`admin${item[0].toUpperCase()}${item.slice(1)}`);
          return (
            <Link
              key={item}
              href={`/settings?tab=${item}`}
              aria-current={tab === item ? "page" : undefined}
              className={cn(
                "inline-flex min-h-10 shrink-0 items-center rounded-nav px-3 text-[12px] font-semibold",
                tab === item
                  ? "bg-accent-weak text-accent"
                  : "text-fg-3 hover:bg-surface-2 hover:text-fg",
              )}
            >
              {label}
            </Link>
          );
        })}
      </nav>

      {tab === "overview" && (
        <div className="space-y-5">
          <QueueMetrics
            items={[
              {
                label: t("adminUsers"),
                value: staff.length,
                meta: t("readOnly"),
                tone: "accent",
              },
              {
                label: t("adminRoles"),
                value: STAFF_ROLES.length,
                meta: t("serverEnforced"),
                tone: "info",
              },
              {
                label: t("configuredNotVerified"),
                value: [
                  integrations.whatsapp,
                  integrations.telephony,
                  integrations.ai,
                  integrations.amocrm.status === "configured",
                ].filter(Boolean).length,
                meta: `/ 4`,
                tone: "warn",
              },
              {
                label: t("adminAudit"),
                value: audit.length,
                meta: t("operationalAudit"),
                tone: "ok",
              },
            ]}
          />

          <ContextBanner
            title={t("liveNotVerified")}
            description={t("adminReadinessTruth")}
            tone="warning"
          />

          <section aria-labelledby="readiness-title">
            <h2 id="readiness-title" className="mb-3 text-[15px] font-bold text-fg">
              {t("readinessStatus")}
            </h2>
            <div className="grid gap-3 md:grid-cols-2">
              {[
                {
                  icon: "message-circle" as IconName,
                  title: t("waSection"),
                  pill: platformWahaPill,
                  iconTone: "info",
                  detail: `evo-inbox · ${t("serverEnforced")}`,
                  href: "/settings?tab=integrations#whatsapp",
                },
                {
                  icon: "phone" as IconName,
                  title: t("telSection"),
                  pill: integrations.telephony
                    ? { tone: "info" as const, label: t("configuredNotVerified") }
                    : { tone: "warn" as const, label: t("statusNotConfigured") },
                  iconTone: integrations.telephony ? "info" : "warn",
                  detail: integrations.telephony
                    ? t("telephonyConfiguredNotVerified")
                    : t("telephonyUnavailable"),
                  href: "/settings?tab=integrations#telephony",
                },
                {
                  icon: "message-square" as IconName,
                  title: t("aiSection"),
                  pill: integrations.ai
                    ? { tone: "info" as const, label: t("configuredNotVerified") }
                    : { tone: "warn" as const, label: t("statusNotConfigured") },
                  iconTone: integrations.ai ? "info" : "warn",
                  detail: integrations.ai ? t("aiDraftManualOnly") : t("statusNotConfigured"),
                  href: "/settings?tab=integrations#ai",
                },
                {
                  icon: "funnel" as IconName,
                  title: t("amocrmSection"),
                  pill: amoPill,
                  iconTone:
                    integrations.amocrm.status === "blocked"
                      ? "danger"
                      : integrations.amocrm.status === "configured"
                        ? "info"
                        : "warn",
                  detail: amoStatusText,
                  href: "/settings?tab=integrations#amocrm",
                },
              ].map((item) => (
                <Link
                  key={item.title}
                  href={item.href}
                  className="group rounded-card border border-border bg-surface p-4 shadow-evo hover:border-border-strong"
                >
                  <div className="flex items-start gap-3">
                    <span className={cn(
                      "grid h-10 w-10 shrink-0 place-items-center rounded-nav",
                      item.iconTone === "danger"
                        ? "bg-danger-weak text-danger"
                        : item.iconTone === "info"
                          ? "bg-info-weak text-info"
                          : "bg-warn-weak text-warn",
                    )}>
                      <Icon name={item.icon} size={18} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-[13.5px] font-bold text-fg">{item.title}</h3>
                        <StatusPill
                          tone={item.pill.tone}
                          label={item.pill.label}
                        />
                      </div>
                      <p className="mt-2 break-words text-[12px] leading-5 text-fg-3">
                        {item.detail}
                      </p>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        </div>
      )}

      {tab === "users" && (
        <section className="space-y-4">
          <ContextBanner
            title={t("readOnly")}
            description={t("usersReadOnlyHint")}
            tone="info"
          />
          <div className="grid gap-3 md:grid-cols-2">
            {staff.map((person) => (
              <article key={person.id} className="rounded-card border border-border bg-surface p-4 shadow-evo">
                <div className="flex items-start gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent-weak font-mono text-[11px] font-bold text-accent">
                    {person.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("")}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-[13.5px] font-bold text-fg">{person.name}</h2>
                    <p className="truncate text-[12px] text-fg-3">{person.email}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <StatusPill tone="info" label={t(`role.${person.role}`)} />
                      <span className="font-mono text-[10.5px] text-fg-3">{person.created_at}</span>
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {tab === "roles" && (
        <section className="space-y-4">
          <ContextBanner
            title={t("serverEnforced")}
            description={t("rolesReadOnlyHint")}
            tone="info"
          />
          <div
            className="overflow-x-auto rounded-card border border-border bg-surface shadow-evo focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            role="region"
            aria-label={t("adminRoles")}
            tabIndex={0}
          >
            <table className="w-full min-w-[760px] text-left text-[12px]">
              <thead className="border-b border-border bg-surface-2 text-[10.5px] uppercase text-fg-3">
                <tr>
                  <th className="px-4 py-3 font-semibold">{t("section")}</th>
                  {STAFF_ROLES.map((role) => (
                    <th key={role} className="px-3 py-3 text-center font-semibold">{t(`role.${role}`)}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {STAFF_NAV_ITEMS.map((item) => (
                  <tr key={item.href}>
                    <td className="px-4 py-3 font-semibold text-fg">{t(item.labelKey)}</td>
                    {STAFF_ROLES.map((role) => {
                      const allowed = (item.allowedRoles as readonly string[]).includes(role);
                      return (
                        <td key={role} className="px-3 py-3 text-center">
                          <span
                            className={cn(
                              "inline-grid h-7 w-7 place-items-center rounded-full",
                              allowed ? "bg-ok-weak text-ok" : "bg-surface-2 text-fg-3",
                            )}
                            role="img"
                            aria-label={allowed ? t("accessAllowed") : t("accessDenied")}
                          >
                            {allowed ? <Icon name="check" size={16} strokeWidth={2.4} /> : <span aria-hidden="true">—</span>}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[12px] text-fg-3">{t("mutationUnavailable")}</p>
        </section>
      )}

      {tab === "audit" && (
        <section className="space-y-4">
          <ContextBanner
            title={t("securityAuditUnavailable")}
            description={t("operationalAuditHint")}
            tone="warning"
          />
          <div className="rounded-card border border-border bg-surface shadow-evo">
            <header className="border-b border-border px-4 py-3">
              <h2 className="text-[14px] font-bold text-fg">{t("operationalAudit")}</h2>
            </header>
            {audit.length === 0 ? (
              <EmptyState text={t("noAuditEvents")} />
            ) : (
              <ol className="divide-y divide-border">
                {audit.map((event) => (
                  <li key={event.id} className="flex items-start gap-3 px-4 py-3">
                    <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-nav bg-surface-2 text-fg-2">
                      <Icon
                        name={event.kind === "call" ? "phone" : event.kind === "chat" ? "message-square" : "funnel"}
                        size={15}
                      />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <h3 className="text-[12.5px] font-bold text-fg">
                          {t(`audit.${event.kind}`)} · {event.title}
                        </h3>
                        <time className="font-mono text-[10.5px] text-fg-3">{event.occurred_at}</time>
                      </div>
                      {event.detail && <p className="mt-1 break-words text-[12px] text-fg-3">{event.detail}</p>}
                      {event.actor_name && <p className="mt-1 text-[10.5px] text-fg-3">{event.actor_name}</p>}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </section>
      )}

      {tab === "integrations" && (
        <>
      <form action={saveSettingsAction} className="space-y-5">
        {/* WhatsApp */}
        <section id="whatsapp" className="scroll-mt-24 rounded-card border border-border bg-surface shadow-evo">
          {header("message-circle", t("waSection"), platformWahaPill)}
          <div className="space-y-3 px-5 py-4" data-testid="legacy-waha-server-managed">
            <p className={noteCls()}>
              {t("readOnly")} · {t("serverEnforced")}. {t("liveNotVerified")}
            </p>
            <dl className="grid gap-3 text-[12px] sm:grid-cols-2">
              <div>
                <dt className="font-semibold text-fg-2">WAHA session</dt>
                <dd><code className="font-mono text-accent">evo-inbox</code></dd>
              </div>
              <div>
                <dt className="font-semibold text-fg-2">Platform webhook</dt>
                <dd className="break-all">
                  <code className="font-mono text-accent">/api/internal/platform-messaging/waha/events</code>
                </dd>
              </div>
            </dl>
          </div>
        </section>

        {/* Telephony */}
        <section id="telephony" className="scroll-mt-24 rounded-card border border-border bg-surface shadow-evo">
          {header("phone", t("telSection"), integrations.telephony ? { tone: "info", label: t("configuredNotVerified") } : { tone: "warn", label: t("statusNotConfigured") })}
          <div className="grid gap-3 px-5 py-4 sm:grid-cols-2">
            <label className={labelCls}>
              {t("telProvider")}
              <select name="tel_provider" defaultValue={fields.tel_provider ?? ""} className={cn(inputCls, "mt-1")}>
                <option value="">—</option>
                <option value="sipuni">Sipuni</option>
                <option value="zadarma">Zadarma</option>
                <option value="mango">Mango Office</option>
                <option value="other">{t("otherPbx")}</option>
              </select>
            </label>
            <label className={labelCls}>
              {t("telApiKey")}
              <input name="tel_api_key" type="password" placeholder={fields.tel_api_key ? masked(fields.tel_api_key) : ""} className={cn(inputCls, "mt-1")} />
            </label>
            <p className={cn(noteCls(), "sm:col-span-2")}>
              {t("telWebhookHint")}<br />
              <code className="font-mono text-accent">{t("exampleDomain")}/api/webhooks/telephony</code>
            </p>
          </div>
        </section>

        {/* Claude AI */}
        <section id="ai" className="scroll-mt-24 rounded-card border border-border bg-surface shadow-evo">
          {header("message-square", t("aiSection"), integrations.ai ? { tone: "info", label: t("configuredNotVerified") } : { tone: "warn", label: t("statusNotConfigured") })}
          <div className="px-5 py-4">
            <label className={labelCls}>
              {t("aiApiKey")}
              <input
                name="anthropic_api_key"
                placeholder={fields.anthropic_api_key ? masked(fields.anthropic_api_key) : "sk-ant-…"}
                type="password"
                className={cn(inputCls, "mt-1")}
              />
            </label>
            <p className={cn(noteCls(), "mt-3")}>{t("anthropicKeyHint")}</p>
          </div>
        </section>

        {/* amoCRM */}
        <section id="amocrm" className="scroll-mt-24 rounded-card border border-border bg-surface shadow-evo">
          {header("funnel", t("amocrmSection"), amoPill)}
          <div className="space-y-4 px-5 py-4">
            <p className={cn("rounded-ctl px-3 py-2.5 text-[12px]", PILL_TONE[amoPill.tone])}>{amoStatusText}</p>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className={labelCls}>
                {t("amocrmAccount")}
                <input name="amocrm_account_base_url" defaultValue={fields.amocrm_account_base_url ?? ""} placeholder="evoadmissions.amocrm.ru" className={cn(inputCls, "mt-1")} />
              </label>
              <label className={labelCls}>
                {t("amocrmClientId")}
                <input name="amocrm_client_id" defaultValue={fields.amocrm_client_id ?? ""} className={cn(inputCls, "mt-1")} />
              </label>
              <label className={labelCls}>
                {t("amocrmClientSecret")}
                <input name="amocrm_client_secret" type="password" placeholder={fields.amocrm_client_secret ? masked(fields.amocrm_client_secret) : ""} className={cn(inputCls, "mt-1")} />
              </label>
              <label className={labelCls}>
                {t("amocrmRefreshToken")}
                <input name="amocrm_refresh_token" type="password" placeholder={fields.amocrm_refresh_token ? masked(fields.amocrm_refresh_token) : ""} className={cn(inputCls, "mt-1")} />
              </label>
              <label className={cn(labelCls, "sm:col-span-2")}>
                {t("amocrmRedirectUri")}
                <input name="amocrm_redirect_uri" defaultValue={fields.amocrm_redirect_uri ?? ""} placeholder="https://your-domain.example/amocrm/oauth/callback" className={cn(inputCls, "mt-1")} />
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className={labelCls}>
                {t("amocrmPipelineId")}
                <input name="amocrm_pipeline_id" inputMode="numeric" defaultValue={fields.amocrm_pipeline_id ?? ""} className={cn(inputCls, "mt-1 font-mono")} />
              </label>
              <label className={labelCls}>
                {t("amocrmStatusId")}
                <input name="amocrm_status_id" inputMode="numeric" defaultValue={fields.amocrm_status_id ?? ""} className={cn(inputCls, "mt-1 font-mono")} />
              </label>
              <label className={labelCls}>
                {t("amocrmResponsibleUserId")}
                <input name="amocrm_responsible_user_id" inputMode="numeric" defaultValue={fields.amocrm_responsible_user_id ?? ""} className={cn(inputCls, "mt-1 font-mono")} />
              </label>
              <label className={labelCls}>
                {t("amocrmCountryFieldId")}
                <input name="amocrm_target_country_field_id" inputMode="numeric" defaultValue={fields.amocrm_target_country_field_id ?? ""} className={cn(inputCls, "mt-1 font-mono")} />
              </label>
              <label className={labelCls}>
                {t("amocrmSourceFieldId")}
                <input name="amocrm_source_field_id" inputMode="numeric" defaultValue={fields.amocrm_source_field_id ?? ""} className={cn(inputCls, "mt-1 font-mono")} />
              </label>
            </div>

            <p className={noteCls()}>
              {t("amocrmCheckHint")}
              {fields.amocrm_last_check ? <><br /><code className="font-mono text-fg-2">{fields.amocrm_last_check}</code></> : null}
            </p>
          </div>
        </section>

        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" className={btnCls}>{t("save")}</button>
        </div>
      </form>

      <form action={checkAmoCrmAction}>
        <button type="submit" className={btnGhostCls}>{t("amocrmCheck")}</button>
      </form>
        </>
      )}
    </div>
  );
}

export default renderLegacySettingsPage;
