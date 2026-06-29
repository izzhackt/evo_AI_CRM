import Link from "next/link";
import { getT } from "@/lib/i18n";
import { allDocuments } from "@/lib/queries";
import { DOC_STATUSES } from "@/lib/db";
import { setDocumentStatusAction } from "@/lib/actions";
import { requireStaffRoute } from "@/lib/guards";
import { Badge, Card, EmptyState, btnGhostCls, cn } from "@/components/ui";
import { Icon } from "@/components/icons";

const selectCls = "rounded-nav border border-border-strong bg-surface-2 px-2 py-1.5 text-[12px] text-fg focus:border-accent focus:outline-none";

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await requireStaffRoute("/documents");
  const { t } = await getT();
  const { status } = await searchParams;
  const selectedStatus = status && (DOC_STATUSES as readonly string[]).includes(status) ? status : undefined;
  const documents = allDocuments({ status: selectedStatus });
  const allRows = selectedStatus ? allDocuments() : documents;
  const statusCount = (value: string) => allRows.filter((doc) => doc.status === value).length;

  const pills = [
    { value: "", label: t("all"), count: allRows.length, active: !selectedStatus, href: "/documents" },
    ...DOC_STATUSES.map((value) => ({
      value,
      label: t(`doc.${value}`),
      count: statusCount(value),
      active: selectedStatus === value,
      href: `/documents?status=${value}`,
    })),
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        {pills.map((p) => (
          <Link
            key={p.value || "all"}
            href={p.href}
            className={cn(
              "inline-flex min-h-9 items-center gap-2 rounded-full px-3 text-[12.5px] font-medium transition-[background-color,color] duration-150",
              p.active ? "bg-accent text-on-accent" : "bg-surface-2 text-fg-2 hover:text-fg",
            )}
          >
            {p.label}
            <span className={cn("font-mono text-[11.5px]", p.active ? "text-on-accent/80" : "text-fg-3")}>{p.count}</span>
          </Link>
        ))}
      </div>

      <Card bodyClassName="px-0 py-0">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-border bg-surface-2 text-[11px] uppercase tracking-[0.04em] text-fg-3">
              <tr>
                <th className="px-5 py-3 font-semibold">{t("document")}</th>
                <th className="px-4 py-3 font-semibold">{t("client")}</th>
                <th className="px-4 py-3 font-semibold">{t("updatedAt")}</th>
                <th className="px-5 py-3 font-semibold">{t("status")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {documents.map((doc) => (
                <tr key={doc.id} className="align-middle transition-[background-color] hover:bg-surface-2">
                  <td className="px-5 py-3">
                    <Link href={`/clients/${doc.client_id}`} className="flex items-center gap-2.5">
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-nav bg-surface-2 text-fg-3">
                        <Icon name="file-check" size={16} />
                      </span>
                      <span className="min-w-0">
                        <span className="block font-medium text-fg hover:text-accent">{doc.name}</span>
                        {doc.comment && <span className="block truncate text-[12px] text-fg-3">{doc.comment}</span>}
                      </span>
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/clients/${doc.client_id}`} className="font-medium text-fg hover:text-accent">
                      {doc.client_name}
                    </Link>
                    <div className="mt-1"><Badge value={doc.stage} label={t(`stage.${doc.stage}`)} /></div>
                  </td>
                  <td className="px-4 py-3 font-mono text-[12.5px] text-fg-2">{doc.updated_at}</td>
                  <td className="px-5 py-3">
                    <form action={setDocumentStatusAction} className="flex min-w-44 items-center gap-1.5">
                      <input type="hidden" name="id" value={doc.id} />
                      <input type="hidden" name="client_id" value={doc.client_id} />
                      <select name="status" defaultValue={doc.status} className={cn(selectCls, "w-full")}>
                        {DOC_STATUSES.map((value) => (
                          <option key={value} value={value}>{t(`doc.${value}`)}</option>
                        ))}
                      </select>
                      <button type="submit" className={btnGhostCls}>{t("save")}</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {documents.length === 0 && (
          <div className="px-5 py-4"><EmptyState text={selectedStatus ? t("noFilteredDocuments") : t("noDocuments")} /></div>
        )}
      </Card>
    </div>
  );
}
