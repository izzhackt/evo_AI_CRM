import { AGENT_MASCOTS } from "./agent-mascots";

const SIZE = { sm: 28, md: 40, lg: 128 } as const;

/**
 * Маскот агента в чате (12.11.2026, по просьбе Айвара): крупный — в пустом чате, маленький — у подписи ответа и в строке
 * «Думает…». `working` — агент работает: маскот покачивается (`.v3-aia-mascot[data-working]`), без движения при
 * `prefers-reduced-motion`. Обычный `<img>`: чат — клиентский компонент, файл уже маленький. Картинка декоративная: имя агента и ход работы сказаны текстом рядом. Нет маскота — ничего.
 */
export function NextAgentMascot({ agentKey, size, working = false }: Readonly<{ agentKey: string; size: keyof typeof SIZE; working?: boolean }>) {
  const mascot = AGENT_MASCOTS[agentKey];
  if (!mascot) return null;
  const px = SIZE[size];
  return (
    // eslint-disable-next-line @next/next/no-img-element -- статический WebP 10 КБ из сборки; клиентский чат обходится без оптимизатора
    <img
      src={mascot.src}
      alt=""
      aria-hidden="true"
      width={px}
      height={px}
      data-working={working ? "" : undefined}
      data-testid={`v3-aia-mascot-${size}`}
      className="v3-aia-mascot shrink-0 object-contain"
      style={{ width: px, height: px }}
    />
  );
}
