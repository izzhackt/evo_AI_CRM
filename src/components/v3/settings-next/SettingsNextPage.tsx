"use client";

import { PageShell, SectionTabs } from "@/components/kit";

import { BlockingNotice } from "./BlockingNotice";
import { SettingsSection } from "./SettingsSection";
import type { SettingsNextProps } from "./settings-next-types";

/**
 * «Настройки» в новом виде: рамка страницы, ряд разделов-ссылок (адрес несёт `?section=` и `&view=`: раздел можно переслать, вернуться
 * кнопкой «Назад», открыть без JavaScript) и содержимое раздела. Чтения и права — у страницы (`settings/page.tsx`: целиком для
 * Admin, одна «Телефония» для держателя `telephony.manage`, у него нового вида нет); здесь только расстановка. Число у «Запросов на
 * удаление» — открытые запросы (срок — 30 дней).
 */
export function SettingsNextPage(props: SettingsNextProps) {
  const navKey = (item: SettingsNextProps["nav"][number]) => `${item.key}:${item.view ?? ""}`;
  const current = props.nav.find((item) => item.current) ?? props.nav[0];
  return (
    <PageShell title="Настройки" testId="v3-settings">
      {props.section === "integrations" ? null : <BlockingNotice rows={props.integrations} href={props.integrationsHref} />}
      <SectionTabs
        label="Разделы настроек"
        tabs={props.nav.map((item) => ({ key: navKey(item), label: item.title, href: item.href, count: item.count }))}
        value={navKey(current)}
      />
      <SettingsSection {...props} />
    </PageShell>
  );
}
