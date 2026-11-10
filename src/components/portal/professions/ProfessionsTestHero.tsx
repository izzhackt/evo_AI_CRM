import Link from "next/link";

import { formatPortalString, type PortalStrings } from "@/lib/portal/i18n";
import type { OrvisState } from "@/lib/portal/profession-guide";

/**
 * Тест интересов в центре страницы (разбор владельца 10.11.2026, п. 1):
 * крупный блок «Не знаешь, кем стать?» с прогрессом, если тест начат или
 * пройден. Состояние — собственный orvis92; нет данных — блок без полосы.
 */
export function ProfessionsTestHero({
  state,
  strings,
}: {
  state: OrvisState | null;
  strings: PortalStrings<"professions">;
}) {
  const total = state?.questionCount ?? 92;
  const answered = state?.draftAnswered ?? (state?.completed ? total : null);
  const action = state?.draftAnswered != null
    ? { href: "/portal/tests/career", label: strings.testContinue, primary: true }
    : state?.completed
      ? { href: "/portal/tests/career?new=1", label: strings.testRetake, primary: false }
      : { href: "/portal/tests/career", label: strings.testStart, primary: true };
  return (
    <section className="pt-prof-hero" aria-labelledby="pt-prof-hero-title">
      <div className="pt-prof-hero-main">
        <p className="pt-prof-hero-kicker">{strings.testKicker}</p>
        <h2 id="pt-prof-hero-title" className="pt-prof-hero-title">{strings.testTitle}</h2>
        <p className="pt-prof-hero-meta">{formatPortalString(strings.testMeta, { count: String(total) })}</p>
      </div>
      <div className="pt-prof-hero-side">
        {answered !== null ? (
          <div className="pt-prof-hero-progress">
            <p className="pt-prof-hero-progress-row">
              <span>{state?.draftAnswered != null ? strings.testDraft : strings.testDone}</span>
              <span className="pt-data">
                {formatPortalString(strings.testProgress, { answered: String(answered), total: String(total) })}
              </span>
            </p>
            <progress className="pt-progress" max={total} value={answered} aria-hidden="true" />
          </div>
        ) : null}
        <Link className={action.primary ? "pt-btn" : "pt-btn-ghost"} href={action.href}>{action.label}</Link>
      </div>
    </section>
  );
}
