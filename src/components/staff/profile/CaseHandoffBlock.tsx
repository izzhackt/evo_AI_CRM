"use client";

import { useEffect, useRef } from "react";

import type { HandoffAcknowledgement } from "@/lib/platform-handoff-acknowledgement";

import { ProfileHandoffAcknowledgement } from "./ProfileSalesTransition";

/**
 * «Принять дело» первым в «Что дальше» — тот же блок и то же действие, что в
 * «Быстром просмотре» (#1059). После ответа сервер перечитывает страницу
 * (`revalidatePath`), и блок уходит в «Сведения»; фокус с исчезнувшей кнопки
 * переходит на заголовок «Что дальше», а не падает на страницу.
 */
export function CaseHandoffBlock({ snapshot, headingId }: Readonly<{
  snapshot: HandoffAcknowledgement & Readonly<{ requestId: string }>;
  headingId: string;
}>) {
  const answered = useRef(false);
  useEffect(() => () => {
    if (!answered.current) return;
    requestAnimationFrame(() => {
      const active = document.activeElement;
      if (active === null || active === document.body) document.getElementById(headingId)?.focus();
    });
  }, [headingId]);
  return (
    <div data-testid="v3-case-handoff">
      <ProfileHandoffAcknowledgement snapshot={snapshot} onSaved={() => { answered.current = true; }} />
    </div>
  );
}
