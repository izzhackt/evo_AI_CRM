import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { allDocuments } from "@/lib/queries";
import { DOC_STATUSES } from "@/lib/db";
import { setDocumentStatusAction } from "@/lib/actions";
import { Badge, Card, EmptyState, StatCard, btnGhostCls, inputCls } from "@/components/ui";

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const user = await currentUser();
  if (!user || user.role === "finance") redirect("/dashboard");

  const { t } = await getT();
  const { status } = await searchParams;
  const documents = allDocuments({ status });
  const allRows = status ? allDocuments() : documents;
  const statusCount = (value: string) => allRows.filter((doc) => doc.status === value).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">{t("documentQueue")}</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">{t("documentQueueHint")}</p>
        </div>
        <Link href="/clients" className={btnGhostCls}>{t("student360")}</Link>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label={t("requiredDocuments")} value={statusCount("required")} />
        <StatCard label={t("uploadedDocuments")} value={statusCount("uploaded")} />
        <StatCard label={t("documentsInReview")} value={statusCount("review")} />
        <StatCard label={t("approvedDocuments")} value={statusCount("approved")} />
      </div>

      <Card title={t("documentQueue")}>
        <form className="mb-4 flex flex-wrap gap-2">
          <select name="status" defaultValue={status ?? ""} className={`${inputCls} max-w-52`}>
            <option value="">{t("allStatuses")}</option>
            {DOC_STATUSES.map((value) => (
              <option key={value} value={value}>{t(`doc.${value}`)}</option>
            ))}
          </select>
          <button type="submit" className={btnGhostCls}>{t("search")}</button>
          {status && <Link href="/documents" className={btnGhostCls}>{t("clearFilter")}</Link>}
        </form>

        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">{t("document")}</th>
                <th className="px-4 py-3">{t("client")}</th>
                <th className="px-4 py-3">{t("comment")}</th>
                <th className="px-4 py-3">{t("status")}</th>
                <th className="px-4 py-3">{t("manager")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {documents.map((doc) => (
                <tr key={doc.id} className="align-top transition hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-900">{doc.name}</td>
                  <td className="px-4 py-3">
                    <Link href={`/clients/${doc.client_id}`} className="font-medium text-indigo-700 hover:underline">
                      {doc.client_name}
                    </Link>
                    <div className="mt-1"><Badge value={doc.stage} label={t(`stage.${doc.stage}`)} /></div>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{doc.comment ?? "—"}</td>
                  <td className="px-4 py-3">
                    <form action={setDocumentStatusAction} className="flex min-w-44 items-center gap-2">
                      <input type="hidden" name="id" value={doc.id} />
                      <input type="hidden" name="client_id" value={doc.client_id} />
                      <select name="status" defaultValue={doc.status} className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-xs">
                        {DOC_STATUSES.map((value) => (
                          <option key={value} value={value}>{t(`doc.${value}`)}</option>
                        ))}
                      </select>
                      <button type="submit" className={btnGhostCls}>{t("save")}</button>
                    </form>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{doc.manager_name ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {documents.length === 0 && <EmptyState text={t("noResults")} />}
        </div>
      </Card>
    </div>
  );
}
