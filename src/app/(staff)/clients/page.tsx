import Link from "next/link";
import { getT } from "@/lib/i18n";
import { listClients } from "@/lib/queries";
import { STAGES } from "@/lib/db";
import { createClientAction } from "@/lib/actions";
import { requireStaffRoute } from "@/lib/guards";
import { Badge, EmptyState, inputCls, btnCls, cn } from "@/components/ui";
import { Icon } from "@/components/icons";

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
}

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ stage?: string; q?: string }>;
}) {
  await requireStaffRoute("/clients");
  const { t } = await getT();
  const { stage, q } = await searchParams;
  const clients = listClients({ stage, q });
  const qs = (s?: string) => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (s) p.set("stage", s);
    const str = p.toString();
    return str ? `/clients?${str}` : "/clients";
  };
  const pillBase = "inline-flex min-h-9 items-center rounded-full px-3 text-[12.5px] font-medium transition-[background-color,color] duration-150";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <form className="flex flex-1 flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-3"><Icon name="search" size={16} /></span>
            <input name="q" defaultValue={q} placeholder={t("search")} className={cn(inputCls, "pl-9")} />
            {stage && <input type="hidden" name="stage" value={stage} />}
          </div>
          <button type="submit" className={btnCls}>{t("search")}</button>
        </form>
        <details id="add" className="relative scroll-mt-24">
          <summary className={cn(btnCls, "cursor-pointer list-none")}>
            <Icon name="plus" size={16} /> {t("addClient")}
          </summary>
          <form
            action={createClientAction}
            className="absolute right-0 z-20 mt-2 w-80 space-y-2.5 rounded-card border border-border bg-surface p-4 shadow-evo-lg"
          >
            <input name="name" required placeholder={t("name")} className={inputCls} />
            <input name="email" type="email" required placeholder={t("email")} className={inputCls} />
            <input name="phone" placeholder={t("phone")} className={inputCls} />
            <input name="target_country" placeholder={t("country")} className={inputCls} />
            <input name="target_degree" placeholder={t("degree")} className={inputCls} />
            <input name="source" placeholder={t("source")} className={inputCls} />
            <button type="submit" className={cn(btnCls, "w-full")}>{t("add")}</button>
          </form>
        </details>
      </div>

      <div className="flex flex-wrap gap-2">
        <Link href={qs()} className={cn(pillBase, !stage ? "bg-accent text-on-accent" : "bg-surface-2 text-fg-2 hover:text-fg")}>
          {t("allStages")}
        </Link>
        {STAGES.map((s) => (
          <Link key={s} href={qs(s)} className={cn(pillBase, stage === s ? "bg-accent text-on-accent" : "bg-surface-2 text-fg-2 hover:text-fg")}>
            {t(`stage.${s}`)}
          </Link>
        ))}
      </div>

      <div className="overflow-x-auto rounded-card border border-border bg-surface shadow-evo">
        <table className="w-full text-left text-[13px]">
          <thead className="border-b border-border bg-surface-2 text-[11px] uppercase tracking-[0.04em] text-fg-3">
            <tr>
              <th className="px-5 py-3 font-semibold">{t("client")}</th>
              <th className="px-4 py-3 font-semibold">{t("stage")}</th>
              <th className="px-4 py-3 font-semibold">{t("country")}</th>
              <th className="px-4 py-3 font-semibold">{t("manager")}</th>
              <th className="px-4 py-3 font-semibold">{t("curator")}</th>
              <th className="px-4 py-3 font-semibold">{t("phone")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {clients.map((c) => (
              <tr key={c.id} className="transition-[background-color] hover:bg-surface-2">
                <td className="px-5 py-3">
                  <Link href={`/clients/${c.id}`} className="flex items-center gap-3">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent-weak text-[11px] font-semibold text-accent">
                      {initials(c.name)}
                    </span>
                    <span className="min-w-0">
                      <span className="block font-semibold text-fg hover:text-accent">{c.name}</span>
                      <span className="block truncate text-[12px] text-fg-3">{c.email}</span>
                    </span>
                  </Link>
                </td>
                <td className="px-4 py-3"><Badge value={c.stage} label={t(`stage.${c.stage}`)} /></td>
                <td className="px-4 py-3 text-fg-2">
                  {[c.target_country, c.target_degree].filter(Boolean).join(" · ") || "—"}
                </td>
                <td className="px-4 py-3 text-fg-2">{c.manager_name ?? "—"}</td>
                <td className="px-4 py-3 text-fg-2">{c.curator_name ?? "—"}</td>
                <td className="px-4 py-3 font-mono text-[12.5px] text-fg-2">{c.phone ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {clients.length === 0 && <EmptyState text={t("noResults")} />}
      </div>
    </div>
  );
}
