/**
 * Статус-пилюля — та же грамматика, что у `StatusChip` (Э1.3–Э1.4): слово
 * обязательно, цвет его только подкрепляет. Здесь отличается лишь содержимое:
 * `StatusChip` берёт строку, `Pill` — узел (например, слово с `data-testid`
 * внутри). Вид — один (`.v3-chip` в v3.css): прозрачный контур у нейтрального
 * слова, бледная подложка у `ok`/`warn`/`danger`/`info`.
 *
 * Тон выбирается по смыслу, а не по красоте. Если для значения нет настоящего
 * состояния — берите `neutral`: серое слово честнее зелёного, поставленного
 * «чтобы было живее». Красный (`danger`) — только проблема.
 */

export type PillTone = "neutral" | "ok" | "warn" | "danger" | "info";

export function Pill({
  tone = "neutral",
  children,
}: {
  tone?: PillTone;
  children: React.ReactNode;
}) {
  return (
    <span className="v3-chip t-caption shrink-0" data-tone={tone}>
      {children}
    </span>
  );
}
