"use client";

import { btnGhostCls } from "@/components/ui";

export default function CanonicalClientsError({ reset }: { reset: () => void }) {
  return (
    <div className="space-y-4 border-y border-border py-8" data-testid="canonical-records-unavailable">
      <h1 className="text-[19px] font-bold text-fg">Канонические клиенты EVO недоступны</h1>
      <p className="max-w-2xl text-[13px] leading-6 text-fg-3">
        Не удалось прочитать канонический реестр. Student Cases и разговоры не
        подставляются вместо личности клиента EVO.
      </p>
      <button type="button" className={btnGhostCls} onClick={reset}>
        Повторить чтение
      </button>
    </div>
  );
}
