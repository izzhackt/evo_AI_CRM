"use client";

import { DetailSheet } from "@/components/kit/DetailSheet";
import { Button } from "@/components/ui/button";

/**
 * Остальные строки ленты - в выезжающей панели: на странице видны последние, старое не удлиняет карточку
 * (CLAUDE.md, «Плотность»). Строки приходят готовыми с сервера (те же `FeedRow`, что в ленте); панель их
 * не перечитывает и ничего не пишет.
 */
export function FeedOverflow({ count, title, children }: Readonly<{ count: number; title: string; children: React.ReactNode }>) {
  return (
    <DetailSheet
      title={title}
      trigger={<Button variant="outline" className="w-fit" aria-label={`Ещё ${count} в ленте`} data-testid="v3-feed-overflow">Ещё {count}</Button>}
    >
      <ol className="divide-y divide-border" data-testid="v3-feed-overflow-items">{children}</ol>
    </DetailSheet>
  );
}
