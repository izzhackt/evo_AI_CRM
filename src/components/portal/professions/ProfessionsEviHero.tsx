import Link from "next/link";

import { EviRobot } from "@/components/portal/evi/EviRobot";
import type { PortalStrings } from "@/lib/portal/i18n";

/**
 * Верх «Профессий» — вход в подбор с Эви вместо карточки теста интересов (решение владельца 17.11.2026): тот же
 * вопрос «Не знаешь, кем стать?», неподвижный робот и одна кнопка в вкладку Эви. Сам тест остаётся в «Тестах»; у
 * ученика без Эви (отозвал согласие на ИИ) страница показывает прежнюю карточку теста.
 */
export function ProfessionsEviHero({ strings }: Readonly<{ strings: PortalStrings<"professions"> }>) {
  return (
    <section className="pt-prof-hero pt-prof-hero-evi" aria-labelledby="pt-prof-hero-title">
      <span className="pt-prof-hero-robot" aria-hidden="true"><EviRobot face="happy" settled still /></span>
      <div className="pt-prof-hero-main">
        <p className="pt-prof-hero-kicker">{strings["tab.evi"]}</p>
        <h2 id="pt-prof-hero-title" className="pt-prof-hero-title">{strings.testTitle}</h2>
        <p className="pt-prof-hero-meta">{strings["evi.heroMeta"]}</p>
      </div>
      <div className="pt-prof-hero-side">
        <Link className="pt-btn" href="/portal/professions?view=evi">{strings["evi.heroAction"]}</Link>
      </div>
    </section>
  );
}
