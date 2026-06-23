import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { logoutAction } from "@/lib/actions";
import { LangSwitcher } from "@/components/LangSwitcher";
import {
  getClientByUserId, clientApplications, clientDocuments,
  clientVisaCase, clientPayments, clientUpdates,
} from "@/lib/queries";
import { STAGES } from "@/lib/db";
import { Badge, Card, EmptyState } from "@/components/ui";

export default async function PortalPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (user.role !== "client") redirect("/dashboard");

  const { t, locale } = await getT();
  const client = getClientByUserId(user.id);
  if (!client) redirect("/login");

  const apps = clientApplications(client.id);
  const docs = clientDocuments(client.id);
  const visa = clientVisaCase(client.id);
  const payments = clientPayments(client.id);
  const updates = clientUpdates(client.id);

  const visibleStages = STAGES.filter((s) => s !== "archived");
  const stageIdx = visibleStages.indexOf(client.stage === "archived" ? "enrolled" : client.stage);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <span className="text-lg font-bold text-indigo-700">🎓 {t("appName")}</span>
          <div className="flex items-center gap-3">
            <LangSwitcher current={locale} />
            <form action={logoutAction}>
              <button className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50">
                {t("logout")}
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-6 px-4 py-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900">
            {t("portalWelcome")}, {user.name}!
          </h1>
          <p className="mt-1 text-sm text-slate-500">{t("portalHint")}</p>
        </div>

        <Card title={t("yourStage")}>
          <ol className="flex flex-wrap gap-2">
            {visibleStages.map((s, i) => {
              const state =
                i < stageIdx ? "bg-green-100 text-green-800"
                : i === stageIdx ? "bg-indigo-600 text-white"
                : "bg-slate-100 text-slate-400";
              return (
                <li key={s} className={`rounded-full px-3 py-1 text-xs font-medium ${state}`}>
                  {i < stageIdx ? "✓ " : ""}{t(`stage.${s}`)}
                </li>
              );
            })}
          </ol>
        </Card>

        <Card title={t("latestUpdates")}>
          {updates.length === 0 ? (
            <EmptyState text={t("noUpdates")} />
          ) : (
            <ul className="space-y-3">
              {updates.map((u) => (
                <li key={u.id} className="rounded-lg bg-indigo-50/60 px-4 py-3">
                  <p className="text-sm text-slate-800">{u.message}</p>
                  <p className="mt-1 text-xs text-slate-400">{u.author_name ?? t("appName")} · {u.created_at}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="grid gap-6 sm:grid-cols-2">
          <Card title={t("yourDocuments")}>
            {docs.length === 0 ? (
              <EmptyState text={t("noResults")} />
            ) : (
              <ul className="divide-y divide-slate-100">
                {docs.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-2 py-2">
                    <span className="text-sm text-slate-800">{d.name}</span>
                    <Badge value={d.status} label={t(`doc.${d.status}`)} />
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title={t("yourApplications")}>
            {apps.length === 0 ? (
              <EmptyState text={t("noResults")} />
            ) : (
              <ul className="divide-y divide-slate-100">
                {apps.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-2 py-2">
                    <div>
                      <div className="text-sm font-medium text-slate-800">{a.university}</div>
                      <div className="text-xs text-slate-500">{[a.program, a.country].filter(Boolean).join(" · ")}</div>
                    </div>
                    <Badge value={a.status} label={t(`app.${a.status}`)} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        {visa && (
          <Card title={t("visa")}>
            <div className="flex flex-wrap items-center gap-3 text-sm text-slate-700">
              <span className="font-medium">{visa.country}</span>
              <Badge value={visa.status} label={t(`visa.${visa.status}`)} />
              {visa.appointment_at && (
                <span className="text-xs text-slate-500">{t("appointment")}: {visa.appointment_at}</span>
              )}
            </div>
          </Card>
        )}

        <Card title={t("yourPayments")}>
          {payments.length === 0 ? (
            <EmptyState text={t("noResults")} />
          ) : (
            <ul className="divide-y divide-slate-100">
              {payments.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 py-2">
                  <div>
                    <div className="text-sm font-medium text-slate-800">{p.title}</div>
                    <div className="text-xs text-slate-500">
                      {p.amount.toLocaleString("ru-RU")} {p.currency}
                      {p.due_date ? ` · ${t("dueDate")}: ${p.due_date}` : ""}
                    </div>
                  </div>
                  <Badge value={p.status} label={t(`pay.${p.status}`)} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </main>
    </div>
  );
}
