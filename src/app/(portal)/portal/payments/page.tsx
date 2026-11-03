import type { Metadata } from "next";

import { getLocale } from "@/lib/i18n";
import { getPortalStrings } from "@/lib/portal/i18n";

import { PaymentsView } from "@/components/portal/admission/PaymentsView";
import { readStudentPortalPayments } from "@/lib/v3/portal-source";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const strings = getPortalStrings("admission", await getLocale());
  return { title: `${strings.paymentsTitle} — EVO Admissions` };
}

export default async function StudentPortalPaymentsPage() {
  const [payments, locale] = await Promise.all([readStudentPortalPayments(), getLocale()]);
  const strings = getPortalStrings("admission", locale);

  return (
    <main className="pt-page">
      <header className="pt-page-header">
        <h1 className="pt-page-title">{strings.paymentsTitle}</h1>
      </header>
      <PaymentsView payments={payments} locale={locale} />
    </main>
  );
}
