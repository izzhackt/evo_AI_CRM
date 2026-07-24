import Link from "next/link";
import { notFound } from "next/navigation";
import { getT } from "@/lib/i18n";
import {
  getClient, clientApplications, clientDocuments, clientVisaCase,
  clientPayments, clientTasks, clientUpdates, listStaff, studentPortalSnapshotForUser,
} from "@/lib/queries";
import { STAGES, APP_STATUSES, TASK_COLUMNS, TASK_PRIORITIES, VISA_STATUSES } from "@/lib/db";
import {
  updateClientAction, addApplicationAction, setApplicationStatusAction,
  addDocumentAction, upsertVisaCaseAction,
  addPaymentAction, markPaymentPaidAction, addTaskAction, moveTaskAction, postUpdateAction,
} from "@/lib/actions";
import { requireStaffRoute } from "@/lib/guards";
import { Badge, Card, EmptyState, StatCard, inputCls, btnCls, btnGhostCls, labelCls, cn } from "@/components/ui";
import { AiSummary } from "@/components/AiSummary";
import { StudentProgress } from "@/components/platform/core/StudentProgress";
const selectCls = "rounded-nav border border-border-strong bg-surface-2 px-2 py-1.5 text-[12px] text-fg focus:border-accent focus:outline-none";

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
}

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireStaffRoute("/clients");
  const { id } = await params;
  const clientId = parseInt(id, 10);
  const client = getClient(clientId);
  if (!client) notFound();

  const { t, locale } = await getT();
  const num = (value: number) =>
    value.toLocaleString({ ru: "ru-RU", ky: "ky-KG", en: "en-US" }[locale]);
  const apps = clientApplications(clientId);
  const docs = clientDocuments(clientId);
  const visa = clientVisaCase(clientId);
  const payments = clientPayments(clientId);
  const tasks = clientTasks(clientId);
  const updates = clientUpdates(clientId);
  const staff = listStaff();
  const snapshot = studentPortalSnapshotForUser(client.user_id);
  if (!snapshot) notFound();
  const activeApps = apps.filter((app) => app.status === "preparing" || app.status === "submitted").length;
  const openDocuments = docs.filter((doc) => doc.status !== "approved").length;
  const pendingPayments = payments.filter((payment) => payment.status !== "paid").length;
  const openTasks = tasks.filter((task) => task.status !== "done").length;
  const nextDeadline = apps.find((app) => app.deadline && app.status !== "enrolled" && app.status !== "rejected")?.deadline ?? "—";
  const canMutatePayments = user?.role === "admin" || user?.role === "finance";
  const stageItems = snapshot.stageTimeline.map((item) => ({
    key: item.stage,
    label: t(item.labelKey),
  }));
  const nextActionHref = snapshot.nextAction?.labelKey === "portalNextTask"
    ? "#tasks"
    : snapshot.nextAction?.labelKey === "portalNextDocument"
      ? "#documents"
      : snapshot.nextAction?.labelKey === "portalNextDeadline"
        ? "#applications"
        : snapshot.nextAction?.labelKey === "portalNextPayment" || snapshot.nextAction?.labelKey === "portalNextOverduePayment"
          ? "#payments"
          : snapshot.nextAction?.labelKey === "portalNextVisa"
            ? "#visa"
            : "#overview";
  const rejectedDocument = snapshot.documents.find((document) => document.status === "rejected");
  const overduePayment = snapshot.payments.find((payment) => payment.status === "overdue");
  const rejectedVisa = snapshot.visa?.status === "rejected" ? snapshot.visa : null;
  const blocker = rejectedDocument
    ? { label: t("documents"), detail: rejectedDocument.name, href: "#documents" }
    : overduePayment
      ? { label: t("payments"), detail: overduePayment.title, href: "#payments" }
      : rejectedVisa
        ? { label: t("visaCase"), detail: rejectedVisa.country, href: "#visa" }
        : !snapshot.manager && !snapshot.curator
          ? { label: t("portalTeam"), detail: t("notAssigned"), href: "#profile" }
          : null;

  return (
    <div className="space-y-5">
      <header className="rounded-card border border-border bg-surface p-4 shadow-evo sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <span className="grid h-[60px] w-[60px] shrink-0 place-items-center rounded-full bg-accent-weak text-[20px] font-semibold text-accent">
            {initials(client.name)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-fg-3">{t("student360")}</p>
            <div className="mt-1 flex flex-wrap items-center gap-2.5">
              <h1 className="text-[22px] font-bold leading-tight text-fg">{client.name}</h1>
              <Badge value={client.stage} label={t(`stage.${client.stage}`)} />
            </div>
            <div className="mt-1.5 break-words font-mono text-[12.5px] text-fg-3">
              {client.email}{client.phone ? `  ·  ${client.phone}` : ""}
            </div>
          </div>
          <div className="flex flex-wrap gap-2 sm:justify-end">
            <Link href="/clients" className={btnGhostCls}>{t("clients")}</Link>
            {client.phone && <a href={`tel:${client.phone}`} className={btnGhostCls}>{t("phone")}</a>}
            <a href="#updates" className={btnCls}>{t("updates")}</a>
          </div>
        </div>
      </header>

      <section
        aria-labelledby="student-source-title"
        className="flex items-start gap-3 rounded-card border border-info/20 bg-info-weak px-4 py-3.5 text-info"
      >
        <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-info" aria-hidden="true" />
        <div>
          <h2 id="student-source-title" className="text-[12px] font-bold uppercase tracking-[0.06em]">
            {t("operationalContext")}
          </h2>
          <p className="mt-1 max-w-4xl text-[12.5px] leading-5 text-fg-2">{t("studentRecordSourceHint")}</p>
        </div>
      </section>

      <nav aria-label={t("student360")} className="-mx-1 overflow-x-auto px-1 pb-1">
        <div className="flex min-w-max gap-1.5">
          {[
            ["overview", t("portalOverview")],
            ["profile", t("portalProfile")],
            ["applications", t("applications")],
            ["documents", t("documents")],
            ["visa", t("visaCase")],
            ["tasks", t("openWork")],
            ["payments", t("payments")],
            ["updates", t("updates")],
          ].map(([anchor, label]) => (
            <a
              key={anchor}
              href={`#${anchor}`}
              className="inline-flex min-h-9 items-center rounded-full border border-border bg-surface px-3 text-[12px] font-semibold text-fg-2 transition-colors hover:border-border-strong hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
              {label}
            </a>
          ))}
        </div>
      </nav>

      <div id="overview" className="grid scroll-mt-24 gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-5">
          <div className="grid gap-3 md:grid-cols-2">
            <section className="rounded-card border border-border bg-surface p-4 shadow-evo" aria-labelledby="student-next-action">
              <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-fg-3">{t("portalNextAction")}</p>
              {snapshot.nextAction ? (
                <>
                  <h2 id="student-next-action" className="mt-2 text-[16px] font-bold text-fg">{t(snapshot.nextAction.labelKey)}</h2>
                  <p className="mt-1 text-[13px] leading-5 text-fg-2">{snapshot.nextAction.detail}</p>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono text-[11px] text-fg-3">
                      {snapshot.nextAction.dueDate ?? t("portalNoFixedDate")}
                    </span>
                    <a href={nextActionHref} className={btnGhostCls}>{t("open")}</a>
                  </div>
                </>
              ) : (
                <>
                  <h2 id="student-next-action" className="mt-2 text-[16px] font-bold text-fg">{t("portalNoNextAction")}</h2>
                  <p className="mt-1 text-[13px] leading-5 text-fg-2">{t("portalNoNextActionHint")}</p>
                </>
              )}
            </section>

            <section
              className={cn(
                "rounded-card border p-4 shadow-evo",
                blocker ? "border-danger/25 bg-danger-weak" : "border-border bg-surface",
              )}
              aria-labelledby="student-blocker"
            >
              <p className={cn("text-[11px] font-bold uppercase tracking-[0.08em]", blocker ? "text-danger" : "text-fg-3")}>
                {t("risk")}
              </p>
              <h2 id="student-blocker" className="mt-2 text-[16px] font-bold text-fg">
                {blocker?.label ?? t("studentRiskNotRecorded")}
              </h2>
              {blocker && (
                <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[13px] leading-5 text-fg-2">{blocker.detail}</p>
                  <a href={blocker.href} className={btnGhostCls}>{t("open")}</a>
                </div>
              )}
            </section>
          </div>

          <section className="rounded-card border border-border bg-surface p-4 shadow-evo sm:p-5" aria-labelledby="student-progress">
            <h2 id="student-progress" className="mb-4 text-[14px] font-bold text-fg">{t("portalProgress")}</h2>
            <StudentProgress
              stages={stageItems}
              currentStage={client.stage}
              label={t("portalProgress")}
              currentLabel={t(`stage.${client.stage}`)}
            />
          </section>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <StatCard label={t("activeApplications")} value={num(activeApps)} href="#applications" tone="info" />
            <StatCard label={t("openDocuments")} value={num(openDocuments)} href="#documents" tone="warning" />
            <StatCard label={t("openWork")} value={num(openTasks)} href="#tasks" tone="accent" />
            <StatCard label={t("pendingPayments")} value={num(pendingPayments)} href="#payments" tone="danger" />
            <StatCard label={t("nextDeadline")} value={nextDeadline} />
          </div>
        </div>

        <aside className="space-y-4 xl:sticky xl:top-24 xl:self-start" aria-label={t("portalTeam")}>
          <div className="rounded-card border border-border bg-surface p-4 shadow-evo">
            <h2 className="text-[14px] font-bold text-fg">{t("portalTeam")}</h2>
            <dl className="mt-3 space-y-3">
              {[
                [t("manager"), snapshot.manager],
                [t("curator"), snapshot.curator],
              ].map(([role, contact]) => (
                <div key={String(role)} className="rounded-ctl bg-surface-2 p-3">
                  <dt className="text-[10.5px] font-bold uppercase tracking-[0.06em] text-fg-3">{String(role)}</dt>
                  <dd className="mt-1 text-[13px] font-semibold text-fg">
                    {typeof contact === "object" && contact ? contact.name : t("notAssigned")}
                  </dd>
                  {typeof contact === "object" && contact && (
                    <dd className="mt-1 break-words font-mono text-[10.5px] text-fg-3">
                      {contact.email}{contact.phone ? ` · ${contact.phone}` : ""}
                    </dd>
                  )}
                </div>
              ))}
            </dl>
          </div>

          <div className="rounded-card border border-border bg-surface p-4 shadow-evo">
            <h2 className="text-[14px] font-bold text-fg">{t("latestUpdates")}</h2>
            {updates.length === 0 ? (
              <p className="mt-3 text-[12.5px] text-fg-3">{t("noUpdates")}</p>
            ) : (
              <ol className="mt-3 space-y-3 border-l border-border pl-3">
                {updates.slice(0, 3).map((update) => (
                  <li key={update.id}>
                    <p className="text-[12.5px] leading-5 text-fg">{update.message}</p>
                    <p className="mt-1 font-mono text-[10.5px] text-fg-3">{update.created_at}</p>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div className="rounded-card border border-border bg-surface p-4 shadow-evo">
            <p className="mb-3 text-[11px] leading-4 text-fg-3">{t("studentAiSummaryHint")}</p>
            <AiSummary
              clientId={client.id}
              labels={{ button: t("aiSummary"), thinking: t("aiThinking"), notConfigured: t("aiNotConfigured") }}
            />
          </div>
        </aside>
      </div>

      {/* Profile */}
      <section id="profile" className="scroll-mt-24">
        <Card title={t("client")}>
        <form action={updateClientAction} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <input type="hidden" name="client_id" value={client.id} />
          <label className={labelCls}>
            {t("stage")}
            <select name="stage" defaultValue={client.stage} className={cn(inputCls, "mt-1")}>
              {STAGES.map((s) => <option key={s} value={s}>{t(`stage.${s}`)}</option>)}
            </select>
          </label>
          <label className={labelCls}>
            {t("manager")}
            <select name="manager_id" defaultValue={client.manager_id ?? ""} className={cn(inputCls, "mt-1")}>
              <option value="">{t("notAssigned")}</option>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.name} — {t(`role.${s.role}`)}</option>)}
            </select>
          </label>
          <label className={labelCls}>
            {t("curator")}
            <select name="curator_id" defaultValue={client.curator_id ?? ""} className={cn(inputCls, "mt-1")}>
              <option value="">{t("notAssigned")}</option>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.name} — {t(`role.${s.role}`)}</option>)}
            </select>
          </label>
          <label className={labelCls}>
            {t("country")}
            <input name="target_country" defaultValue={client.target_country ?? ""} className={cn(inputCls, "mt-1")} />
          </label>
          <label className={labelCls}>
            {t("degree")}
            <input name="target_degree" defaultValue={client.target_degree ?? ""} className={cn(inputCls, "mt-1")} />
          </label>
          <label className={cn(labelCls, "sm:col-span-2 lg:col-span-3")}>
            {t("notes")}
            <textarea name="notes" defaultValue={client.notes ?? ""} rows={2} className={cn(inputCls, "mt-1 resize-y py-2")} />
          </label>
          <div><button type="submit" className={btnCls}>{t("save")}</button></div>
        </form>
        </Card>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Applications */}
        <section id="applications" className="min-w-0 scroll-mt-24">
          <Card title={t("applications")}>
          <ul className="divide-y divide-border">
            {apps.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0">
                <div className="min-w-0">
                  <div className="text-[13.5px] font-medium text-fg">{a.university}</div>
                  <div className="text-[12px] text-fg-3">
                    {[a.program, a.country, a.deadline ? `${t("deadline")}: ${a.deadline}` : null].filter(Boolean).join(" · ")}
                  </div>
                </div>
                <form action={setApplicationStatusAction} className="flex w-full items-center gap-1.5 sm:w-auto">
                  <input type="hidden" name="id" value={a.id} />
                  <input type="hidden" name="client_id" value={client.id} />
                  <select name="status" defaultValue={a.status} className={cn(selectCls, "min-w-0 flex-1 sm:flex-none")}>
                    {APP_STATUSES.map((s) => <option key={s} value={s}>{t(`app.${s}`)}</option>)}
                  </select>
                  <button type="submit" className={btnGhostCls}>{t("save")}</button>
                </form>
              </li>
            ))}
          </ul>
          {apps.length === 0 && <EmptyState text={t("noResults")} />}
          <form action={addApplicationAction} className="mt-3 grid gap-2 border-t border-border pt-3 sm:grid-cols-2">
            <input type="hidden" name="client_id" value={client.id} />
            <input name="university" required placeholder={t("university")} className={inputCls} />
            <input name="program" placeholder={t("program")} className={inputCls} />
            <input name="degree" placeholder={t("degree")} className={inputCls} />
            <input name="country" placeholder={t("country")} className={inputCls} />
            <input name="deadline" type="date" className={cn(inputCls, "font-mono")} />
            <button type="submit" className={cn(btnCls, "sm:col-span-2")}>+ {t("addApplication")}</button>
          </form>
          </Card>
        </section>

        {/* Documents */}
        <section id="documents" className="min-w-0 scroll-mt-24">
          <Card title={t("documents")}>
          <ul className="divide-y divide-border">
            {docs.map((d) => (
              <li key={d.id} className="flex flex-col gap-3 py-3 first:pt-0 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <Link href={`/documents/${d.id}`} className="break-words text-[13.5px] font-semibold text-fg hover:text-accent">
                    {d.name}
                  </Link>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <Badge value={d.status} label={t(`doc.${d.status}`)} />
                    {d.comment && <span className="text-[11.5px] leading-4 text-danger">{d.comment}</span>}
                  </div>
                </div>
                <Link href={`/documents/${d.id}`} className={cn(btnGhostCls, "w-full shrink-0 sm:w-auto")}>
                  {t("documentDetail")}
                </Link>
              </li>
            ))}
          </ul>
          {docs.length === 0 && <EmptyState text={t("noResults")} />}
          <form action={addDocumentAction} className="mt-3 flex flex-col gap-2 border-t border-border pt-3 sm:flex-row">
            <input type="hidden" name="client_id" value={client.id} />
            <input name="name" required placeholder={t("document")} className={inputCls} />
            <button type="submit" className={cn(btnCls, "sm:w-11 sm:px-0")}>+</button>
          </form>
          </Card>
        </section>

        {/* Visa */}
        <section id="visa" className="min-w-0 scroll-mt-24">
          <Card title={t("visaCase")}>
          <form action={upsertVisaCaseAction} className="grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="client_id" value={client.id} />
            <label className={labelCls}>
              {t("country")}
              <input name="country" defaultValue={visa?.country ?? client.target_country ?? ""} className={cn(inputCls, "mt-1")} />
            </label>
            <label className={labelCls}>
              {t("status")}
              <select name="status" defaultValue={visa?.status ?? "not_started"} className={cn(inputCls, "mt-1")}>
                {VISA_STATUSES.map((s) => <option key={s} value={s}>{t(`visa.${s}`)}</option>)}
              </select>
            </label>
            <label className={labelCls}>
              {t("appointment")}
              <input name="appointment_at" type="date" defaultValue={visa?.appointment_at ?? ""} className={cn(inputCls, "mt-1 font-mono")} />
            </label>
            <label className={labelCls}>
              {t("notes")}
              <input name="notes" defaultValue={visa?.notes ?? ""} className={cn(inputCls, "mt-1")} />
            </label>
            <div className="sm:col-span-2">
              <button type="submit" className={btnCls}>{visa ? t("save") : `+ ${t("addVisaCase")}`}</button>
            </div>
          </form>
          </Card>
        </section>

        {/* Open work */}
        <section id="tasks" className="min-w-0 scroll-mt-24">
          <Card title={t("openWork")}>
          <ul className="divide-y divide-border">
            {tasks.map((task) => (
              <li key={task.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0">
                <div className="min-w-0">
                  <div className="text-[13.5px] font-medium text-fg">{task.title}</div>
                  <div className="text-[12px] text-fg-3">
                    {[task.assignee_name, task.due_date ? `${t("dueDate")}: ${task.due_date}` : null, t(`prio.${task.priority}`)]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
                <form action={moveTaskAction} className="flex w-full items-center gap-1.5 sm:w-auto">
                  <input type="hidden" name="id" value={task.id} />
                  <select name="status" defaultValue={task.status} className={cn(selectCls, "min-w-0 flex-1 sm:flex-none")}>
                    {TASK_COLUMNS.map((s) => <option key={s} value={s}>{t(`col.${s}`)}</option>)}
                  </select>
                  <button type="submit" className={btnGhostCls}>{t("save")}</button>
                </form>
              </li>
            ))}
          </ul>
          {tasks.length === 0 && <EmptyState text={t("noStudentTasks")} />}
          <form action={addTaskAction} className="mt-3 grid gap-2 border-t border-border pt-3 sm:grid-cols-2">
            <input type="hidden" name="client_id" value={client.id} />
            <input name="title" required placeholder={t("title")} className={cn(inputCls, "sm:col-span-2")} />
            <select name="priority" defaultValue="normal" className={inputCls}>
              {TASK_PRIORITIES.map((p) => <option key={p} value={p}>{t(`prio.${p}`)}</option>)}
            </select>
            <select name="assignee_id" className={inputCls}>
              <option value="">{t("assignee")}: {t("notAssigned")}</option>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <input name="due_date" type="date" className={cn(inputCls, "font-mono")} />
            <button type="submit" className={btnCls}>+ {t("addTask")}</button>
          </form>
          </Card>
        </section>

        {/* Payments */}
        <section id="payments" className="min-w-0 scroll-mt-24 lg:col-span-2">
          <Card title={t("payments")}>
          <ul className="divide-y divide-border">
            {payments.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0">
                <div className="min-w-0">
                  <div className="text-[13.5px] font-medium text-fg">{p.title}</div>
                  <div className="font-mono text-[12px] text-fg-3">
                    {num(p.amount)} {p.currency}
                    {p.due_date ? ` · ${t("dueDate")}: ${p.due_date}` : ""}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge value={p.status} label={t(`pay.${p.status}`)} />
                  {canMutatePayments && p.status !== "paid" && (
                    <form action={markPaymentPaidAction}>
                      <input type="hidden" name="id" value={p.id} />
                      <input type="hidden" name="client_id" value={client.id} />
                      <button type="submit" className={btnGhostCls}>{t("markPaid")}</button>
                    </form>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {payments.length === 0 && <EmptyState text={t("noResults")} />}
          {canMutatePayments && (
            <form action={addPaymentAction} className="mt-3 grid gap-2 border-t border-border pt-3 sm:grid-cols-2">
              <input type="hidden" name="client_id" value={client.id} />
              <input name="title" required placeholder={t("payment")} className={cn(inputCls, "sm:col-span-2")} />
              <input name="amount" type="number" step="0.01" required placeholder={t("amount")} className={inputCls} />
              <select name="currency" className={inputCls}>
                <option value="KGS">KGS</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
              </select>
              <input name="due_date" type="date" className={cn(inputCls, "font-mono")} />
              <button type="submit" className={btnCls}>+ {t("addPayment")}</button>
            </form>
          )}
          </Card>
        </section>
      </div>

      {/* Updates */}
      <section id="updates" className="scroll-mt-24">
        <Card title={t("updates")}>
        <form action={postUpdateAction} className="mb-4 flex flex-col gap-2 sm:flex-row">
          <input type="hidden" name="client_id" value={client.id} />
          <input name="message" required placeholder={t("updatePlaceholder")} className={inputCls} />
          <button type="submit" className={btnCls}>{t("send")}</button>
        </form>
        {updates.length === 0 ? (
          <EmptyState text={t("noUpdates")} />
        ) : (
          <ul className="space-y-2.5">
            {updates.map((u) => (
              <li key={u.id} className="rounded-ctl bg-surface-2 px-4 py-3">
                <p className="text-[13.5px] text-fg">{u.message}</p>
                <p className="mt-1 font-mono text-[11px] text-fg-3">
                  {u.author_name ?? "—"} · {u.created_at}
                </p>
              </li>
            ))}
          </ul>
        )}
        </Card>
      </section>
    </div>
  );
}
