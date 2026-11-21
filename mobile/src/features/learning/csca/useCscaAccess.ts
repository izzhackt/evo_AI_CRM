import { useCountryChoice } from "@/api/queries";
import { cscaAvailableFor } from "@web/lib/portal/csca-home-card";

/**
 * Раздел CSCA только для студента с выбором «Китай» (решение владельца 21.11.2026; веб: `cscaAvailableFor`).
 * `pending` — выбор ещё не прочитан; сбой чтения после повторов считается «не Китай».
 */
export function useCscaAccess(): { pending: boolean; available: boolean } {
  const choice = useCountryChoice();
  return { pending: choice.isPending, available: cscaAvailableFor(choice.data ?? null) };
}
