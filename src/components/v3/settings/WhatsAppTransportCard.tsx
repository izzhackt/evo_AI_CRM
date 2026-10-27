import { StatusChip } from "@/components/v3/blocks/StatusChip";
import type { PlatformWhatsAppTransport } from "@/lib/platform-whatsapp-transport";
import { formatSettingsCheck } from "@/lib/v3/settings-health";
import { WHATSAPP_CONNECT_ANCHOR } from "@/lib/v3/whatsapp-connect-contract";
import {
  WAZZUP_FALLBACK_LINE,
  WAZZUP_TITLE,
  capitalizeRu,
  wazzupCardRows,
  wazzupChannelWords,
} from "@/lib/v3/wazzup-words";

/**
 * «Настройки → Интеграции»: канал WhatsApp продаж, пока действующий путь - Wazzup (план Wazzup §8). Стоит на месте
 * блока «Подключение WhatsApp»: у Wazzup кнопки QR и кода нет, а запасной путь WAHA выключен - это сказано одной
 * строкой. Показывает только то, чего нет в строке таблицы выше: тип канала, последнее входящее, приём, ответы.
 * Ключа, адреса вебхука и номера канала здесь нет (максимум - четыре последние цифры, если база их отдаёт).
 * Блок только для чтения: действий в нём нет.
 */
export function WhatsAppTransportCard({
  transport,
  intakeEnabled,
  now,
}: Readonly<{ transport: PlatformWhatsAppTransport; intakeEnabled: boolean; now: Date }>) {
  const words = wazzupChannelWords(transport.channel?.state ?? null, {
    observedAt: transport.channel?.observedAt ?? null,
    nowMs: now.getTime(),
  });
  const rows = wazzupCardRows(transport, intakeEnabled, (iso) => formatSettingsCheck(iso, now));
  return (
    <section
      id={WHATSAPP_CONNECT_ANCHOR}
      aria-labelledby="v3-wazzup-card-title"
      data-testid="v3-wazzup-card"
      data-tone={words.tone}
      className="mt-5 scroll-mt-4 overflow-hidden rounded-card border border-border bg-surface"
    >
      <h3 id="v3-wazzup-card-title" className="t-section flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border px-4 py-2.5 text-fg">
        {WAZZUP_TITLE}
        <StatusChip label={capitalizeRu(words.label)} tone={words.tone} />
      </h3>
      <dl className="px-4 py-1">
        {rows.map((row) => (
          <div key={row.label} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-b border-border py-2.5 last:border-b-0">
            <dt className="t-body-compact text-fg-2">{row.label}</dt>
            <dd className="t-body-compact text-fg tabular-nums">{row.value}</dd>
          </div>
        ))}
      </dl>
      <p className="border-t border-border px-4 py-3 t-body-compact text-fg-2" data-testid="v3-wazzup-fallback">{WAZZUP_FALLBACK_LINE}</p>
    </section>
  );
}
