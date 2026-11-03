import Link from "next/link";

import type { ActivePlatformActor } from "@/lib/platform-auth";
import {
  PARENT_PHONE_LOOKALIKES_WORDS as WORDS,
  parentPhoneCaseHref,
  parentPhoneRelationText,
  type ParentPhoneLookalikesState,
  type ParentPhoneSubject,
} from "@/lib/parent-phone-lookalikes-contract";
import { readParentPhoneLookalikes } from "@/lib/v3/parent-phone-lookalikes-source";

/**
 * Вид подсказки по уже прочитанному состоянию (без чтения: его делает страница, а статический
 * рендер и тесты подают синтетику). Два уровня. Читаемые дела: «Похоже на: <имя>» со ссылкой. Совпадение
 * в деле, которого сотрудник не читает: одна фраза без имени, ссылки и числа («Номер совпадает с
 * телефоном родителя в другом деле. Уточните у руководителя поступления.»), одна и та же для одного
 * скрытого дела и для десяти. Пусто и «нет права» ничего не рисуют; сбой чтения говорит словами.
 * Больше пяти читаемых дел: показаны первые пять и сказано, что их больше.
 * Цвет подложки `info` означает состояние записи («похоже, это семья другого студента»), а не тревогу.
 */
export function ParentPhoneLookalikesView({ state }: Readonly<{ state: ParentPhoneLookalikesState }>) {
  if (state.status === "unavailable") {
    return <p role="status" className="t-body-compact text-fg-2" data-testid="v3-parent-phone-lookalikes-unavailable">{WORDS.unavailable}</p>;
  }
  if (state.matches.length === 0) {
    if (!state.restricted) return null;
    return (
      <section aria-label={WORDS.label} data-testid="v3-parent-phone-restricted" className="rounded-card bg-info-weak px-4 py-3">
        <p className="t-body-compact text-fg">{WORDS.restricted}</p>
      </section>
    );
  }
  return (
    <section aria-label={WORDS.label} data-testid="v3-parent-phone-lookalikes" className="rounded-card bg-info-weak px-4 py-3">
      <div className="flex min-w-0 flex-col sm:flex-row sm:flex-wrap sm:items-baseline sm:gap-x-2">
        <p className="t-body-compact font-medium text-fg">{WORDS.label}:</p>
        <ul className="min-w-0 sm:flex-1">
          {state.matches.map((match) => (
            <li key={match.studentCaseId} data-testid="v3-parent-phone-lookalike" data-relation={match.relation}
              className="flex min-w-0 flex-wrap items-baseline gap-x-2 t-body-compact text-fg">
              <Link href={parentPhoneCaseHref(match.studentCaseId)}
                className="inline-flex min-h-11 min-w-0 items-center break-words font-medium text-fg underline underline-offset-4 hover:text-fg-2">
                {match.studentName}
              </Link>
              <span className="min-w-0 text-fg-2">{WORDS.kind}, {parentPhoneRelationText(match.relation)}</span>
            </li>
          ))}
        </ul>
      </div>
      {state.more ? <p className="mt-2 t-caption text-fg-2" data-testid="v3-parent-phone-more">{WORDS.more}</p> : null}
      {state.restricted ? <p className="mt-2 t-body-compact text-fg" data-testid="v3-parent-phone-restricted-beside">{WORDS.restrictedBeside}</p> : null}
      <p className="mt-2 t-caption text-fg-2">{WORDS.note}</p>
    </section>
  );
}

/** Подсказка «Похоже на» над карточкой лида или дела: свое чтение, как у «Заявок с сайта». */
export async function ParentPhoneLookalikes({ actor, subject }: Readonly<{ actor: ActivePlatformActor; subject: ParentPhoneSubject }>) {
  return <ParentPhoneLookalikesView state={await readParentPhoneLookalikes(actor, subject)} />;
}
