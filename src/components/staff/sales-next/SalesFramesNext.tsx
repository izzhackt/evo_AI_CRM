import { randomUUID } from "node:crypto";

import { isStaffPreview, staffHasPermission } from "@/lib/platform-access";
import type { ActivePlatformActor } from "@/lib/platform-auth";
import { salesReportContext, type SalesReportQuery } from "@/lib/sales-register-navigation";
import { ORG_TIMEZONE } from "@/lib/v3/period";
import { readSalesManagerLabels, readSalesRegisterManagement } from "@/lib/v3/sales-register-source";

import { SalesManagerLabelsBody } from "../sales-report/SalesManagerLabelsBody";
import { SalesRegisterImport } from "../SalesRegisterForms";
import { SalesFrameNextLazy } from "./SalesNextLazy";

const reportContext = (query: SalesReportQuery) => {
  const now = new Intl.DateTimeFormat("en-CA", { timeZone: ORG_TIMEZONE, year: "numeric", month: "2-digit" }).formatToParts(new Date());
  return salesReportContext(query, { year: Number(now.find((part) => part.type === "year")!.value), month: Number(now.find((part) => part.type === "month")!.value) });
};

/** «Перенос данных отчёта» нового вида: те же чтение доступа, сообщения и форма, что у прежнего вида, в рамке с возвратом к отчёту. */
export async function SalesImportNextView({ actor, query }: Readonly<{ actor: ActivePlatformActor; query: SalesReportQuery }>) {
  const context = reportContext(query);
  const management = context.valid ? await readSalesRegisterManagement(actor, null) : null;
  const unavailable = management?.status === "unavailable";
  const allowed = management?.status === "ready" && management.data.canImport;
  // A hint only keeps an existing draft mounted and disabled after a failed read.
  const showForm = allowed || (unavailable && !isStaffPreview(actor) && staffHasPermission(actor, "sales.register.import"));
  return (
    <SalesFrameNextLazy title="Перенос данных отчёта" back={{ href: context.reportHref, label: "Вернуться к отчёту" }}>
      {!context.valid ? <p role="alert" className="t-body-compact text-fg-2">Проверьте год, месяц и фильтры в отчёте перед переносом данных.</p> : null}
      {unavailable ? <p role="alert" className="t-body-compact text-fg-2">Не удалось проверить доступ к переносу данных. Обновите страницу.</p> : null}
      {context.valid && !unavailable && !allowed ? <p role="status" className="t-body-compact text-fg-2">Нет доступа к переносу данных отчёта.</p> : null}
      {showForm ? <div className="max-w-[860px]"><SalesRegisterImport requestId={randomUUID()} readUnavailable={unavailable} /></div> : null}
    </SalesFrameNextLazy>
  );
}

/** «Менеджеры в отчёте» нового вида: те же чтение и строки с формами; пояснение про написания — за «?». */
export async function SalesManagersNextView({ actor, query }: Readonly<{ actor: ActivePlatformActor; query: SalesReportQuery }>) {
  const context = reportContext(query);
  const read = await readSalesManagerLabels(actor);
  return (
    <SalesFrameNextLazy title="Менеджеры в отчёте" back={{ href: context.reportHref, label: "Вернуться к отчёту" }}
      help="Написания с разным регистром, пробелами и точкой в конце — один менеджер. Пока имени нет, отчёт показывает самое частое написание.">
      <SalesManagerLabelsBody read={read} />
    </SalesFrameNextLazy>
  );
}

/** «Отчёт продаж» роли, которая читает лиды, но не записи отчёта: рамка нового вида, граница роли на виду и прежний раздел «Динамика». */
export function SalesDynamicsNextView({ dynamics }: Readonly<{ dynamics: React.ReactNode }>) {
  return (
    <SalesFrameNextLazy title="Отчёт продаж" back={null}>
      <p className="t-body-compact text-fg-2">Записи продаж вашей роли недоступны: здесь лиды за период и доска продаж.</p>
      {dynamics}
    </SalesFrameNextLazy>
  );
}
