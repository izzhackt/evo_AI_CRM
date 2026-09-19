import type { Metadata } from "next";

import { getLocale } from "@/lib/i18n";
import { getPortalStrings } from "@/lib/portal/i18n";

import { PaymentsView } from "@/components/portal/admission/PaymentsView";
import { readStudentPortalPayments } from "@/lib/v3/portal-source";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Оплата — EVO Admissions",
};

export default async function StudentPortalPaymentsPage() {
  const payments = await readStudentPortalPayments();

  return (
    <main className="pt-page">
      <header className="pt-page-header">
        <p className="pt-page-kicker">{getPortalStrings("admission", getLocale()).kicker}</p>
        <h1 className="pt-page-title">Оплата</h1>
        <p className="pt-page-lead">Сколько начислено, оплачено и осталось.</p>
      </header>
      <PaymentsView payments={payments} />
    </main>
  );
}
