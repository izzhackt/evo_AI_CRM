import { notFound } from "next/navigation";
import { getT } from "@/lib/i18n";
import {
  getClient, clientApplications, clientDocuments, clientVisaCase,
  clientPayments, clientTasks, clientUpdates, listStaff,
} from "@/lib/queries";
import { STAGES, APP_STATUSES, DOC_STATUSES, TASK_COLUMNS, TASK_PRIORITIES, VISA_STATUSES } from "@/lib/db";
import {
  updateClientAction, addApplicationAction, setApplicationStatusAction,
  addDocumentAction, setDocumentStatusAction, upsertVisaCaseAction,
  addPaymentAction, markPaymentPaidAction, addTaskAction, moveTaskAction, postUpdateAction,
} from "@/lib/actions";
import { requireStaffRoute } from "@/lib/guards";
import { Badge, Card, EmptyState, StatCard, inputCls, btnCls, btnGhostCls, labelCls, cn } from "@/components/ui";
import { AiSummary } from "@/components/AiSummary";

const num = (n: number) => n.toLocaleString("ru-RU");
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

  const { t } = await getT();
  const apps = clientApplications(clientId);
  const docs = clientDocuments(clientId);
  const visa = clientVisaCase(clientId);
  const payments = clientPayments(clientId);
  const tasks = clientTasks(clientId);
  const updates = clientUpdates(clientId);
  const staff = listStaff();
  const activeApps = apps.filter((app) => app.status === "preparing" || app.status === "submitted").length;
  const openDocuments = docs.filter((doc) => doc.status !== "approved").length;
  const pendingPayments = payments.filter((payment) => payment.status !== "paid").length;
  const openTasks = tasks.filter((task) => task.status !== "done").length;
  const nextDeadline = apps.find((app) => app.deadline && app.status !== "enrolled" && app.status !== "rejected")?.deadline ?? "—";
  const canMutatePayments = user?.role === "admin" || user?.role === "finance";

  return (
    <div className="space-y-5">
      {/* Identity header */}
      <div className="rounded-card border border-border bg-surface p-5 shadow-evo">
        <div className="flex flex-wrap items-center gap-4">
          <span className="grid h-[60px] w-[60px] shrink-0 place-items-center rounded-full bg-accent-weak text-[20px] font-semibold text-accent">
            {initials(client.name)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-[20px] font-bold leading-tight text-fg">{client.name}</h1>
              <Badge value={client.stage} label={t(`stage.${client.stage}`)} />
            </div>
            <div className="mt-1.5 font-mono text-[12.5px] text-fg-3">
              {client.email}{client.phone ? `  ·  ${client.phone}` : ""}
            </div>
          </div>
          <AiSummary
            clientId={client.id}
            labels={{ button: t("aiSummary"), thinking: t("aiThinking"), notConfigured: t("aiNotConfigured") }}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard label={t("activeApplications")} value={num(activeApps)} href="/applications" tone="info" />
        <StatCard label={t("openDocuments")} value={num(openDocuments)} href="/documents" tone="warning" />
        <StatCard label={t("openWork")} value={num(openTasks)} href="/tasks" tone="accent" />
        <StatCard label={t("pendingPayments")} value={num(pendingPayments)} href="/finance" tone="danger" />
        <StatCard label={t("nextDeadline")} value={nextDeadline} />
      </div>

      {/* Profile */}
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

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Applications */}
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
                <form action={setApplicationStatusAction} className="flex items-center gap-1.5">
                  <input type="hidden" name="id" value={a.id} />
                  <input type="hidden" name="client_id" value={client.id} />
                  <select name="status" defaultValue={a.status} className={selectCls}>
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

        {/* Documents */}
        <Card title={t("documents")}>
          <ul className="divide-y divide-border">
            {docs.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0">
                <span className="text-[13.5px] text-fg">{d.name}</span>
                <form action={setDocumentStatusAction} className="flex items-center gap-1.5">
                  <input type="hidden" name="id" value={d.id} />
                  <input type="hidden" name="client_id" value={client.id} />
                  <select name="status" defaultValue={d.status} className={selectCls}>
                    {DOC_STATUSES.map((s) => <option key={s} value={s}>{t(`doc.${s}`)}</option>)}
                  </select>
                  <button type="submit" className={btnGhostCls}>{t("save")}</button>
                </form>
              </li>
            ))}
          </ul>
          {docs.length === 0 && <EmptyState text={t("noResults")} />}
          <form action={addDocumentAction} className="mt-3 flex gap-2 border-t border-border pt-3">
            <input type="hidden" name="client_id" value={client.id} />
            <input name="name" required placeholder={t("document")} className={inputCls} />
            <button type="submit" className={cn(btnCls, "w-11 px-0")}>+</button>
          </form>
        </Card>

        {/* Visa */}
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

        {/* Open work */}
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
                <form action={moveTaskAction} className="flex items-center gap-1.5">
                  <input type="hidden" name="id" value={task.id} />
                  <select name="status" defaultValue={task.status} className={selectCls}>
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

        {/* Payments */}
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
      </div>

      {/* Updates */}
      <Card title={t("updates")}>
        <form action={postUpdateAction} className="mb-4 flex gap-2">
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
    </div>
  );
}
