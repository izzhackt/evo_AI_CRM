import { AGENT_MASCOTS } from "./agent-mascots";

/**
 * Размер в пикселях (ширина и высота в разметке — запас места до загрузки) и классы показа. Средний, 40 px, на телефоне 32 px:
 * на 360 px шириной название «Директор / Аналитик» (250 px) с маскотом и «?» иначе не помещается в строку шапки.
 */
const SIZE = {
  sm: { px: 28, className: "size-7" },
  md: { px: 40, className: "size-8 sm:size-10" },
  lg: { px: 128, className: "size-32" },
} as const;

/**
 * Маскот агента в чате и в шапке страницы агента (12.11.2026, по просьбе Айвара): крупный — в пустом чате, средний — в шапке и в
 * строке «Думает…», маленький — у подписи ответа. `working` — агент работает: маскот покачивается (`.v3-aia-mascot[data-working]`),
 * без движения при `prefers-reduced-motion`. Обычный `<img>`: чат — клиентский компонент, файл уже маленький. Картинка декоративная:
 * имя агента и ход работы сказаны текстом рядом. Нет маскота — ничего.
 */
export function NextAgentMascot({ agentKey, size, working = false }: Readonly<{ agentKey: string; size: keyof typeof SIZE; working?: boolean }>) {
  const mascot = AGENT_MASCOTS[agentKey];
  if (!mascot) return null;
  const { px, className } = SIZE[size];
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
      className={`v3-aia-mascot shrink-0 object-contain ${className}`}
    />
  );
}
