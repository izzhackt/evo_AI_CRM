import { StatusBadge, WidgetCard, type StatusTone } from "@/components/kit";
import type { PlatformWhatsAppTransport } from "@/lib/platform-whatsapp-transport";
import { formatSettingsCheck } from "@/lib/v3/settings-health";
import { WHATSAPP_CONNECT_ANCHOR } from "@/lib/v3/whatsapp-connect-contract";
import { WAZZUP_FALLBACK_LINE, WAZZUP_TITLE, capitalizeRu, wazzupCardRows, wazzupChannelWords } from "@/lib/v3/wazzup-words";

const TONE: Readonly<Record<"ok" | "warn" | "danger", StatusTone>> = { ok: "ok", warn: "warn", danger: "danger" };

/**
 * «Настройки → Интеграции»: канал WhatsApp продаж, пока действующий путь — Wazzup (план Wazzup §8). Стоит на месте блока
 * «Подключение WhatsApp»: у Wazzup кнопки QR и кода нет, а запасной путь WAHA выключен — это сказано одной строкой на виду.
 * Показывает то, чего нет в строке таблицы: тип канала, последнее входящее, приём, ответы. Слово состояния берёт с тем же «сейчас»,
 * что таблица (`wazzupChannelWords` со свежестью отметки): устаревшее «работает» — «состояние не подтверждено», а не зелёный чип.
 * Ключа, адреса вебхука и номера нет (максимум — четыре последние цифры, если база их отдаёт). Блок только для чтения: действий в нём нет.
 */
export function TransportCardNext({ transport, intakeEnabled, nowIso }: Readonly<{ transport: PlatformWhatsAppTransport; intakeEnabled: boolean; nowIso: string }>) {
  const now = new Date(nowIso);
  const words = wazzupChannelWords(transport.channel?.state ?? null, {
    observedAt: transport.channel?.observedAt ?? null,
    nowMs: now.getTime(),
  });
  const rows = wazzupCardRows(transport, intakeEnabled, (iso) => formatSettingsCheck(iso, now));
  return (
    <WidgetCard
      id={WHATSAPP_CONNECT_ANCHOR}
      title={WAZZUP_TITLE}
      actions={<span data-testid="v3-wazzup-state"><StatusBadge tone={TONE[words.tone]} label={capitalizeRu(words.label)} /></span>}
      footer={<p className="t-body-compact text-fg-2" data-testid="v3-wazzup-fallback">{WAZZUP_FALLBACK_LINE}</p>}
      headingLevel={3}
    >
      <div data-testid="v3-wazzup-card" data-tone={words.tone}>
        <dl>
          {rows.map((row) => (
            <div key={row.label} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-b border-border py-2.5 last:border-b-0">
              <dt className="t-body-compact text-fg-2">{row.label}</dt>
              <dd className="t-body-compact tabular-nums text-fg">{row.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </WidgetCard>
  );
}
