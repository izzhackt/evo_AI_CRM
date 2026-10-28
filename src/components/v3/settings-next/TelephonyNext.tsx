import { AlertTriangleIcon } from "lucide-react";

import { WidgetCard } from "@/components/kit";
import { TelephonyExtensions } from "@/components/v3/settings/TelephonyExtensions";
import { TelephonySettingsForm } from "@/components/v3/settings/TelephonySettingsForm";
import type { TelephonyAdminRead } from "@/lib/server/platform-telephony-admin";
import { telephonyStatusLines } from "@/lib/v3/telephony-health";

import { TelephonyGuide } from "./TelephonyGuide";
import { TelephonyStatus } from "./TelephonyStatus";

function Notice({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <p role="status" className="flex items-start gap-2 rounded-card border border-border bg-surface px-4 py-3 t-body-compact text-fg-2" data-testid="v3-telephony-notice">
      <AlertTriangleIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warn" />
      <span>{children}</span>
    </p>
  );
}

/**
 * «Настройки → Телефония» (план телефонии §12, срез T4b): состояние интеграции, пользователи ВАТС и сотрудники, настройки и значения
 * для кабинета ВАТС. Видна держателю `telephony.manage`; пока включатели выключены, раздел честно говорит «выключено». Пользователи и
 * форма настроек — прежние (`TelephonyExtensions`, `TelephonySettingsForm`): те же поля, версии и сохранения; ключи и значения env
 * здесь не показываются никогда.
 */
export function TelephonyNext({ read, readOnly, nowIso }: Readonly<{ read: TelephonyAdminRead | null; readOnly: boolean; nowIso: string }>) {
  if (read === null || read.status === "forbidden") return <Notice>Нет права открывать настройки телефонии.</Notice>;
  if (read.status === "unavailable") return <Notice>Не удалось прочитать настройки телефонии. Обновите страницу позже; если не проходит, передайте техническому специалисту.</Notice>;
  const { overview, server, inboundUrl } = read;
  const flags = overview.settings.flags;
  const off = !flags.uiEnabled && !flags.dialEnabled && !flags.projectionEnabled && !flags.missedTaskEnabled && !flags.unknownLeadEnabled;
  return (
    <div className="grid min-w-0 gap-4" data-testid="v3-settings-telephony" data-switched-off={off || undefined}>
      {off ? <p className="t-body-compact text-fg-2" data-testid="v3-telephony-off">Выключено: ни один включатель не включён, сотрудникам телефония ничего не показывает.</p> : null}
      <TelephonyStatus lines={telephonyStatusLines(server, overview, new Date(nowIso))} />
      <WidgetCard><TelephonyExtensions extensions={overview.extensions} staff={overview.staff} readOnly={readOnly} /></WidgetCard>
      <WidgetCard title="Настройки" headingLevel={3}>
        {/* Ключ — версия: после сохранения страница читает новые настройки, и форма начинается заново. */}
        <TelephonySettingsForm key={overview.settings.version} overview={overview} server={server} readOnly={readOnly} />
      </WidgetCard>
      <TelephonyGuide server={server} inboundUrl={inboundUrl} />
    </div>
  );
}
