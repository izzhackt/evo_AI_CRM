import type { Metadata } from "next";

import { getLocale } from "@/lib/i18n";
import { getPortalStrings } from "@/lib/portal/i18n";

import { PaymentsView } from "@/components/portal/admission/PaymentsView";
import { readPaymentCenter } from "@/lib/portal/payment-center-source";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const strings = getPortalStrings("admission", await getLocale());
  return { title: `${strings.paymentsTitle} — EVO Admissions` };
}

export default async function StudentPortalPaymentsPage() {
  const [center, locale] = await Promise.all([readPaymentCenter(), getLocale()]);
  const strings = getPortalStrings("admission", locale);

  return (
    <main className="pt-page">
      <header className="pt-page-header">
        <h1 className="pt-page-title">{strings.paymentsTitle}</h1>
      </header>
      {center ? (
        <PaymentsView center={center} locale={locale} />
      ) : (
        <p role="alert" className="pt-card pt-adm-empty-body">{strings.paymentsLoadError}</p>
      )}
    </main>
  );
}
