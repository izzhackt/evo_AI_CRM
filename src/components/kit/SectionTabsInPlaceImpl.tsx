"use client";

import type { SectionTabsInPlaceProps } from "@/components/kit/SectionTabsInPlace";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/** Вкладки на месте (Radix): `content` у каждой, `value`/`onValueChange` или `defaultValue`. Подключает `SectionTabsInPlace`. */
export function SectionTabsInPlaceImpl({ label, tabs, value, defaultValue, onValueChange, className }: SectionTabsInPlaceProps) {
  return (
    <Tabs value={value} defaultValue={value === undefined ? (defaultValue ?? tabs[0]?.key) : undefined} onValueChange={onValueChange} className={className}>
      <TabsList aria-label={label}>
        {tabs.map((tab) => (
          <TabsTrigger key={tab.key} value={tab.key}>
            {tab.label}
            {typeof tab.count === "number" ? <span className="tabular-nums text-fg-3">{tab.count}</span> : null}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((tab) => (
        <TabsContent key={tab.key} value={tab.key}>
          {tab.content}
        </TabsContent>
      ))}
    </Tabs>
  );
}
