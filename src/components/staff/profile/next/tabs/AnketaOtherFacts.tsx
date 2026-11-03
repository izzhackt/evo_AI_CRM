import { KeyFacts, type KeyFact } from "@/components/kit/KeyFacts";

import { readLeadInterestState, type LeadInterestState } from "../../LeadInterestFact";
import type { PersonProfile, ProfileDraft } from "../../types";

/** Нужно ли читать «Интересует»: у студента, пришедшего из лида (`profile.leadId`), как у прежней строки «Учёба и планы». */
export const interestNeeded = (profile: PersonProfile): boolean => profile.student && profile.leadId !== null;

/** Интересующее направление лида словами: не выбрано - «пока не выбрано», сбой чтения - слова, не пустота. */
function interestValue(state: LeadInterestState) {
  if (state.status === "error") return <span role="alert" className="text-fg-2">не прочитано</span>;
  return state.status === "value" ? <span>{state.direction}</span> : <span className="text-fg-3">пока не выбрано</span>;
}

/** То же чтение, что у «Сведений» лида (`readLeadInterestState`); ждёт его за своей границей `Suspense` (`AnketaNext`). */
export async function AnketaOtherFactsLoader({ profile, draft }: Readonly<{ profile: PersonProfile; draft: ProfileDraft }>) {
  return <AnketaOtherFacts profile={profile} draft={draft} interest={profile.leadId ? await readLeadInterestState(profile.leadId) : null} />;
}

/** Есть ли что показать в «Других сведениях»: человек, учёба и планы, итог квалификации (то же правило, что у прежней вкладки). */
export function otherFactsShown(profile: PersonProfile, draft: ProfileDraft): boolean {
  const person = [profile.phone, profile.email].some(Boolean) || draft.person.some((fact) => fact.value !== null);
  const study = draft.study.some((fact) => fact.value !== null) || (profile.student && profile.leadId !== null);
  return person || study || Boolean(profile.qualification);
}

/**
 * «Другие сведения дела»: телефон и почта, прочие сведения о человеке, учёба и планы, итог квалификации. Данные те же, что
 * у прежней вкладки («Человек», «Учёба и планы», «Что выяснили при квалификации»); заголовки разделов - `h3`, чтобы читалка
 * видела их внутри карточки или панели.
 */
export function AnketaOtherFacts({ profile, draft, interest }: Readonly<{ profile: PersonProfile; draft: ProfileDraft; interest: LeadInterestState | null }>) {
  const person: KeyFact[] = [{ label: "Телефон", value: profile.phone }, { label: "Почта", value: profile.email }, ...draft.person];
  const study: KeyFact[] = [
    ...(interest ? [{ label: "Интересует", value: interestValue(interest) }] : []),
    ...draft.study,
  ];
  const hasPerson = person.some((fact) => fact.value);
  const hasStudy = study.some((fact) => fact.value);
  return (
    <div className="grid grid-cols-1 gap-5" data-testid="v3-anketa-other">
      {hasPerson ? <section aria-labelledby="anketa-person"><h3 id="anketa-person" className="mb-2 t-item text-fg">Человек</h3><KeyFacts facts={person} columns={2} /></section> : null}
      {hasStudy ? <section aria-labelledby="anketa-study"><h3 id="anketa-study" className="mb-2 t-item text-fg">Учёба и планы</h3><KeyFacts facts={study} columns={2} /></section> : null}
      {profile.qualification ? (
        <section aria-labelledby="anketa-qualification">
          <h3 id="anketa-qualification" className="mb-2 t-item text-fg">Что выяснили при квалификации</h3>
          <p className="whitespace-pre-wrap break-words t-body-compact text-fg">{profile.qualification}</p>
        </section>
      ) : null}
    </div>
  );
}
