import { randomUUID } from "node:crypto";
import Link from "next/link";
import { btnGhostCls } from "@/components/ui";
import { isStaffPreview, staffHasPermission } from "@/lib/platform-access";
import type { ActivePlatformActor } from "@/lib/platform-auth";
import { salesReportContext, type SalesReportQuery } from "@/lib/sales-register-navigation";
import { ORG_TIMEZONE } from "@/lib/v3/period";
import { readSalesRegisterManagement } from "@/lib/v3/sales-register-source";
import { SalesRegisterImport } from "./SalesRegisterForms";

export async function SalesRegisterImportView({ actor, query }: { actor: ActivePlatformActor; query: SalesReportQuery }) {
  const now = new Intl.DateTimeFormat("en-CA", { timeZone: ORG_TIMEZONE, year: "numeric", month: "2-digit" }).formatToParts(new Date());
  const context = salesReportContext(query, {
    year: Number(now.find(p => p.type === "year")!.value), month: Number(now.find(p => p.type === "month")!.value),
  });
  const management = context.valid ? await readSalesRegisterManagement(actor, null) : null;
  const unavailable = management?.status === "unavailable";
  const allowed = management?.status === "ready" && management.data.canImport;
  // A hint only keeps an existing draft mounted and disabled after a failed read.
  const showForm = allowed || (unavailable && !isStaffPreview(actor) && staffHasPermission(actor, "sales.register.import"));

  return <main className="mx-auto w-full min-w-0 max-w-[1240px] px-4 py-8 sm:px-6">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <h1 className="t-page-title text-fg">Перенос данных отчёта</h1>
      <Link href={context.reportHref} className={`${btnGhostCls} min-h-11`}>Вернуться к отчёту</Link>
    </header>
    {!context.valid ? <p role="alert" className="mt-6 text-sm text-fg-2">Проверьте год, месяц и фильтры в отчёте перед переносом данных.</p> : null}
    {unavailable ? <p role="alert" className="mt-6 text-sm text-fg-2">Не удалось проверить доступ к переносу данных. Обновите страницу.</p> : null}
    {context.valid && !unavailable && !allowed ? <p role="status" className="mt-6 text-sm text-fg-2">Нет доступа к переносу данных отчёта.</p> : null}
    <div className="mt-6 max-w-[860px]">
      {showForm ? <SalesRegisterImport requestId={randomUUID()} readUnavailable={unavailable} /> : null}
    </div>
  </main>;
}
