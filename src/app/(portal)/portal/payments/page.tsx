import type { Metadata } from "next";

import { PaymentsView } from "@/components/v3/portal/PaymentsView";
import { PortalPage } from "@/components/v3/portal/PortalPage";
import { readStudentPortalPayments } from "@/lib/v3/portal-source";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Оплата — EVO Admissions",
};

export default async function StudentPortalPaymentsPage() {
  const view = await readStudentPortalPayments();

  return (
    <PortalPage
      title="Оплата"
      description="Опубликованные обязательства: сколько начислено, оплачено и осталось."
    >
      <PaymentsView view={view} />
    </PortalPage>
  );
}
