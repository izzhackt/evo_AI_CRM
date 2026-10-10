import type { ReactNode } from "react";
import type { LeadChannel } from "@/lib/lead-channel-contract";

export type ChannelKey = LeadChannel | "without_lead" | "cabinet";

/**
 * Канал «Откуда узнал» — точка его цвета и слово (решение владельца 10.10.2026, `.v3-channel` в v3.css).
 * Цвет только подкрепляет слово: без подписи его не ставим, текст остаётся в цветах текста; «Не известно»
 * и «без привязки к лиду» — пустой кружок.
 */
export function ChannelLabel({ channel, size, children }: Readonly<{ channel: ChannelKey; size?: "lg"; children: ReactNode }>) {
  return (
    <span className="v3-channel" data-channel={channel} data-size={size}>
      <span aria-hidden="true" className="v3-channel-dot" />
      <span>{children}</span>
    </span>
  );
}

/** Доля в ячейке: тонкая полоса цвета строки (её `data-channel`) под подписью «N из M»; только при знаменателе ≥ 10. */
export function ShareMeter({ part, whole }: Readonly<{ part: number; whole: number }>) {
  const width = whole > 0 ? Math.min(100, Math.max(0, (part * 100) / whole)) : 0;
  return (
    <span aria-hidden="true" className="v3-meter">
      <span style={{ width: `${width}%` }} />
    </span>
  );
}
