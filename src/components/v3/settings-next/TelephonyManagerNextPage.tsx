"use client";

import { PageShell } from "@/components/kit";
import type { TelephonyAdminRead } from "@/lib/server/platform-telephony-admin";

import { TelephonyNext } from "./TelephonyNext";

/**
 * «Настройки» держателя `telephony.manage` без прав Admin: страница открыта ему ради одного раздела «Телефония» (срез T4b),
 * остальные разделы, их чтения и действия — только Admin. Та же рамка и тот же раздел, что у Admin в «Нового виде»
 * (`TelephonyNext`); ряда разделов нет, потому что других разделов у этого сотрудника нет. Права и чтение — у страницы.
 */
export function TelephonyManagerNextPage({ read, nowIso }: Readonly<{ read: TelephonyAdminRead | null; nowIso: string }>) {
  return (
    <PageShell title="Настройки" testId="v3-settings">
      <h2 className="sr-only">Телефония</h2>
      <TelephonyNext read={read} readOnly={false} nowIso={nowIso} />
    </PageShell>
  );
}
