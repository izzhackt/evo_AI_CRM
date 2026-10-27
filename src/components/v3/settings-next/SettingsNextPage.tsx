"use client";

import { PageShell } from "@/components/kit";

import { BlockingNotice } from "./BlockingNotice";
import { SettingsNav } from "./SettingsNav";
import { SettingsSection } from "./SettingsSection";
import type { SettingsNextProps } from "./settings-next-types";

/**
 * «Настройки» в новом виде: рамка страницы, разделы слева (на узком экране — ряд вкладок-ссылок) и содержимое раздела. Чтения и права — у страницы
 * (`settings/page.tsx`: целиком для Admin, одна «Телефония» для держателя `telephony.manage`, у него нового вида нет); здесь только расстановка.
 * Сломанный настроенный сервис — одна строка над разделами (на самих «Интеграциях» то же стоит в таблице).
 */
export function SettingsNextPage(props: SettingsNextProps) {
  return (
    <PageShell title="Настройки" testId="v3-settings">
      {props.section === "integrations" ? null : <BlockingNotice rows={props.integrations} href={props.integrationsHref} />}
      <div className="grid min-w-0 gap-5 @4xl:grid-cols-[minmax(0,13rem)_minmax(0,1fr)] @4xl:items-start">
        <SettingsNav items={props.nav} />
        <SettingsSection {...props} />
      </div>
    </PageShell>
  );
}
