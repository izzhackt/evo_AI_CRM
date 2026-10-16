import type { PortalStrings } from "@/lib/portal/i18n";
import type { CscaTopicState } from "@/lib/portal/csca";

type Strings = PortalStrings<"csca">;

/** Состояние темы всегда словом; цвет только подкрепляет слово (§12). */
export function StateChip({ state, strings }: { state: CscaTopicState; strings: Strings }) {
  return (
    <span className="cs-state" data-state={state}>
      <span className="cs-state-dot" aria-hidden="true" />
      {strings[`state.${state}`]}
    </span>
  );
}

/** Полоса тем раздела: по клетке на тему. Слова рядом, полоса только для взгляда. */
export function TopicStrip({ states }: { states: CscaTopicState[] }) {
  return (
    <span className="cs-strip" aria-hidden="true">
      {states.map((state, index) => <span key={index} data-state={state} />)}
    </span>
  );
}
