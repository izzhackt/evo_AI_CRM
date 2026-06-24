import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { logoutAction } from "@/lib/actions";
import { LangSwitcher } from "@/components/LangSwitcher";
import { studentPortalSnapshotForUser } from "@/lib/queries";
import type { StudentPortalSnapshot } from "@/lib/contracts/student-portal";
import { Badge, Card, EmptyState, StatCard } from "@/components/ui";

function ContactBlock({
  title,
  contact,
  fallback,
}: {
  title: string;
  contact: StudentPortalSnapshot["manager"];
  fallback: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
      <div className="text-xs font-semibold uppercase text-slate-400">{title}</div>
      {contact ? (
        <div className="mt-2">
          <div className="text-sm font-semibold text-slate-900">{contact.name}</div>
          <div className="mt-1 text-xs text-slate-500">{contact.email}</div>
          {contact.phone && <div className="mt-0.5 text-xs text-slate-500">{contact.phone}</div>}
        </div>
      ) : (
        <div className="mt-2 text-sm text-slate-500">{fallback}</div>
      )}
    </div>
  );
}

export default async function PortalPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (user.role !== "client") redirect("/dashboard");

  const { t, locale } = await getT();
  const snapshot = studentPortalSnapshotForUser(user.id);
  if (!snapshot) redirect("/login");

  const progress = snapshot.progressPercent;
  const action = snapshot.nextAction;
  const activeApplications = snapshot.applications.filter((app) => app.status !== "enrolled" && app.status !== "rejected").length;
  const openDocuments = snapshot.documents.filter((doc) => doc.status !== "approved").length;
  const openTasks = snapshot.tasks.length;
  const pendingPayments = snapshot.payments.filter((payment) => payment.status !== "paid").length;
  const navItems = [
    ["#overview", t("portalOverview")],
    ["#applications", t("yourApplications")],
    ["#documents", t("yourDocuments")],
    ["#work", t("portalOpenWork")],
    ["#updates", t("latestUpdates")],
    ["#payments", t("yourPayments")],
  ];

  return (
    <div className="min-h-screen bg-[var(--evo-bg)]">
      <header className="sticky top-0 z-20 border-b border-[var(--evo-border)] bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div>
            <div className="text-xs font-semibold uppercase text-blue-600">EVO Admissions</div>
            <div className="text-base font-semibold text-slate-950">{t("myPortal")}</div>
          </div>
          <nav className="flex max-w-full gap-1 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-1">
            {navItems.map(([href, label]) => (
              <a
                key={href}
                href={href}
                className="whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-white hover:text-blue-700"
              >
                {label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            <LangSwitcher current={locale} />
            <form action={logoutAction}>
              <button className="h-9 rounded-md border border-[var(--evo-border-strong)] bg-white px-3 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700">
                {t("logout")}
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
        <section id="overview" className="grid gap-6 lg:grid-cols-[1.45fr_0.9fr]">
          <div className="rounded-lg border border-[var(--evo-border)] bg-white px-5 py-5 shadow-[var(--evo-shadow-sm)]">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="text-xs font-semibold uppercase text-slate-400">{t("portalWelcome")}</div>
                <h1 className="mt-1 text-2xl font-bold text-slate-950">{user.name}</h1>
                <p className="mt-2 max-w-3xl text-sm text-slate-500">{t("portalHint")}</p>
              </div>
              <Badge value={snapshot.client.stage} label={t(`stage.${snapshot.client.stage}`)} />
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <div>
                <div className="text-xs font-semibold uppercase text-slate-400">{t("country")}</div>
                <div className="mt-1 text-sm font-semibold text-slate-900">
                  {snapshot.client.targetCountry ?? t("notAssigned")}
                </div>
              </div>
              <div>
                <div className="text-xs font-semibold uppercase text-slate-400">{t("degree")}</div>
                <div className="mt-1 text-sm font-semibold text-slate-900">
                  {snapshot.client.targetDegree ?? t("notAssigned")}
                </div>
              </div>
            </div>
            <div className="mt-5">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
                <span>{t("portalProgress")}</span>
                <span>{progress}%</span>
              </div>
              <div className="mt-2 h-2 rounded-full bg-slate-100">
                <div className="h-2 rounded-full bg-blue-600" style={{ width: `${progress}%` }} />
              </div>
            </div>
          </div>

          <Card title={t("portalNextAction")}>
            {action ? (
              <div className="space-y-3">
                <Badge value={action.severity} label={t(action.labelKey)} />
                <div className="text-lg font-semibold text-slate-950">{action.detail}</div>
                <div className="text-sm text-slate-500">
                  {action.dueDate ? `${t("dueDate")}: ${action.dueDate}` : t("portalNoFixedDate")}
                </div>
              </div>
            ) : (
              <div>
                <div className="text-lg font-semibold text-slate-950">{t("portalNoNextAction")}</div>
                <p className="mt-2 text-sm text-slate-500">{t("portalNoNextActionHint")}</p>
              </div>
            )}
          </Card>
        </section>

        <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label={t("activeApplications")} value={activeApplications} href="#applications" />
          <StatCard label={t("openDocuments")} value={openDocuments} href="#documents" />
          <StatCard label={t("openTasks")} value={openTasks} href="#work" />
          <StatCard label={t("pendingPayments")} value={pendingPayments} href="#payments" />
        </section>

        <section id="stage" className="grid gap-6 lg:grid-cols-[1.4fr_0.95fr]">
          <Card title={t("yourStage")}>
            <ol className="grid gap-2 md:grid-cols-3">
              {snapshot.stageTimeline.map((item, index) => {
                const state = item.state;
                const stateClass =
                  state === "complete"
                    ? "border-green-200 bg-green-50 text-green-800"
                    : state === "current"
                      ? "border-blue-200 bg-blue-50 text-blue-800"
                      : "border-slate-200 bg-slate-50 text-slate-500";
                return (
                  <li key={item.stage} className={`rounded-lg border px-3 py-2 ${stateClass}`}>
                    <div className="text-xs font-semibold">{index + 1}. {t(item.labelKey)}</div>
                    <div className="mt-1 text-[11px]">{t(`portalStage.${state}`)}</div>
                  </li>
                );
              })}
            </ol>
          </Card>

          <Card title={t("portalTeam")}>
            <div className="grid gap-3">
              <ContactBlock title={t("manager")} contact={snapshot.manager} fallback={t("notAssigned")} />
              <ContactBlock title={t("curator")} contact={snapshot.curator} fallback={t("notAssigned")} />
            </div>
          </Card>
        </section>

        <section id="applications" className="grid gap-6 lg:grid-cols-2">
          <Card title={t("yourApplications")}>
            {snapshot.applications.length === 0 ? (
              <EmptyState text={t("noResults")} />
            ) : (
              <ul className="divide-y divide-slate-100">
                {snapshot.applications.map((application) => (
                  <li key={application.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">{application.university}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        {[application.program, application.degree, application.country].filter(Boolean).join(" · ") || t("notAssigned")}
                      </div>
                      {application.deadline && (
                        <div className="mt-1 text-xs font-medium text-slate-500">{t("deadline")}: {application.deadline}</div>
                      )}
                    </div>
                    <Badge value={application.status} label={t(`app.${application.status}`)} />
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title={t("visaCase")}>
            {snapshot.visa ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-sm font-semibold text-slate-900">{snapshot.visa.country}</span>
                  <Badge value={snapshot.visa.status} label={t(`visa.${snapshot.visa.status}`)} />
                </div>
                {snapshot.visa.appointmentAt && (
                  <div className="text-sm text-slate-500">{t("appointment")}: {snapshot.visa.appointmentAt}</div>
                )}
                {snapshot.visa.notes && <p className="text-sm text-slate-600">{snapshot.visa.notes}</p>}
              </div>
            ) : (
              <EmptyState text={t("portalNoVisaCase")} />
            )}
          </Card>
        </section>

        <section id="documents" className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <Card title={t("yourDocuments")}>
            {snapshot.documents.length === 0 ? (
              <EmptyState text={t("noResults")} />
            ) : (
              <ul className="divide-y divide-slate-100">
                {snapshot.documents.map((document) => (
                  <li key={document.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">{document.name}</div>
                      {document.comment && <div className="mt-1 text-xs text-slate-500">{document.comment}</div>}
                    </div>
                    <Badge value={document.status} label={t(`doc.${document.status}`)} />
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title={t("portalDocumentReadiness")}>
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-500">{t("approvedDocuments")}</span>
                <span className="font-semibold text-slate-900">
                  {snapshot.documents.filter((doc) => doc.status === "approved").length}/{snapshot.documents.length}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-500">{t("documentsInReview")}</span>
                <span className="font-semibold text-slate-900">
                  {snapshot.documents.filter((doc) => doc.status === "review" || doc.status === "uploaded").length}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-500">{t("requiredDocuments")}</span>
                <span className="font-semibold text-slate-900">
                  {snapshot.documents.filter((doc) => doc.status === "required" || doc.status === "rejected").length}
                </span>
              </div>
            </div>
          </Card>
        </section>

        <section id="work" className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <Card title={t("portalOpenWork")}>
            {snapshot.tasks.length === 0 ? (
              <EmptyState text={t("portalNoOpenWork")} />
            ) : (
              <ul className="divide-y divide-slate-100">
                {snapshot.tasks.map((task) => (
                  <li key={task.id} className="py-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-slate-900">{task.title}</div>
                        {task.description && <div className="mt-1 text-xs text-slate-500">{task.description}</div>}
                        <div className="mt-1 text-xs text-slate-400">
                          {[task.assigneeName, task.dueDate ? `${t("dueDate")}: ${task.dueDate}` : null].filter(Boolean).join(" · ")}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        <Badge value={task.priority} label={t(`prio.${task.priority}`)} />
                        <Badge value={task.status} label={t(`col.${task.status}`)} />
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title={t("portalWhatTeamHandles")}>
            <ul className="space-y-2 text-sm text-slate-600">
              <li>{t("portalTeamHandlesApplications")}</li>
              <li>{t("portalTeamHandlesDocuments")}</li>
              <li>{t("portalTeamHandlesVisa")}</li>
            </ul>
          </Card>
        </section>

        <section id="updates" className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <Card title={t("latestUpdates")}>
            {snapshot.updates.length === 0 ? (
              <EmptyState text={t("noUpdates")} />
            ) : (
              <ul className="space-y-3">
                {snapshot.updates.slice(0, 6).map((update) => (
                  <li key={update.id} className="rounded-lg border border-blue-100 bg-blue-50/60 px-4 py-3">
                    <p className="text-sm text-slate-800">{update.message}</p>
                    <p className="mt-1 text-xs text-slate-500">{update.authorName ?? t("appName")} · {update.createdAt}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title={t("portalProfile")}>
            <div className="space-y-3 text-sm">
              <div>
                <div className="text-xs font-semibold uppercase text-slate-400">{t("email")}</div>
                <div className="mt-1 font-medium text-slate-900">{snapshot.student.email}</div>
              </div>
              <div>
                <div className="text-xs font-semibold uppercase text-slate-400">{t("phone")}</div>
                <div className="mt-1 font-medium text-slate-900">{snapshot.student.phone ?? t("notAssigned")}</div>
              </div>
              <div>
                <div className="text-xs font-semibold uppercase text-slate-400">{t("updatedAt")}</div>
                <div className="mt-1 font-medium text-slate-900">{snapshot.generatedAt}</div>
              </div>
            </div>
          </Card>
        </section>

        <section id="payments">
          <Card title={t("yourPayments")}>
            {snapshot.payments.length === 0 ? (
              <EmptyState text={t("noResults")} />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-slate-100 text-xs uppercase text-slate-400">
                    <tr>
                      <th className="px-2 py-2">{t("payment")}</th>
                      <th className="px-2 py-2">{t("amount")}</th>
                      <th className="px-2 py-2">{t("dueDate")}</th>
                      <th className="px-2 py-2">{t("status")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {snapshot.payments.map((payment) => (
                      <tr key={payment.id}>
                        <td className="px-2 py-3 font-medium text-slate-900">{payment.title}</td>
                        <td className="px-2 py-3 text-slate-600">
                          {payment.amount.toLocaleString("ru-RU")} {payment.currency}
                        </td>
                        <td className="px-2 py-3 text-slate-600">{payment.dueDate ?? "—"}</td>
                        <td className="px-2 py-3"><Badge value={payment.status} label={t(`pay.${payment.status}`)} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </section>
      </main>
    </div>
  );
}
