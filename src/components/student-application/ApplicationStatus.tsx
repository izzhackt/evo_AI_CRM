"use client";

import { useActionState, useEffect } from "react";
import Link from "next/link";
import type { Locale } from "@/lib/i18n-data";
import { formatPortalString, getPortalStrings, type PortalStrings } from "@/lib/portal/i18n";
import { refreshStudentApplicationAction } from "@/lib/student-signup-actions";
import { localizedCountryLabel } from "@/lib/student-application-presentation";
import type { StudentApplication, StudentApplicationDraft } from "@/lib/student-application-contract";
import { logoutStudentPortalAction } from "@/lib/student-portal-auth-actions";

type ApplyStrings = PortalStrings<"apply">;

/**
 * PORT-8c: локализованная сборка ответов анкеты. RU-значения словаря apply
 * зеркалят APPLICATION_LABELS байт-в-байт (закреплено contract-тестом),
 * поэтому RU-вывод совпадает со staff-функцией
 * formatStudentApplicationAnswers; направления показываются подписью
 * field.*, значение анкеты остаётся каноническим RU-текстом.
 */
function localizedAnswers(draft: StudentApplicationDraft, strings: ApplyStrings, locale: Locale): { label: string; value: string }[] {
  const dictionary = strings as Record<string, string>;
  const opt = (key: string) => dictionary[`opt.${key}`] ?? key;
  const fieldLabel = (value: string) => dictionary[`field.${value}`] ?? value;
  const english = draft.english.mode === "exam"
    ? formatPortalString(strings.englishExamAnswer, { exam: opt(draft.english.exam), score: String(draft.english.score) })
    : formatPortalString(strings.englishSelfAnswer, { level: opt(draft.english.level) });
  return [
    { label: strings["answer.name"], value: `${draft.firstName} ${draft.lastName}` },
    { label: strings["answer.phone"], value: draft.phone },
    { label: strings["answer.countries"], value: draft.destinationCountries.map((code) => localizedCountryLabel(code, locale)).join(", ") },
    { label: strings["answer.intake"], value: `${opt(draft.intakeSeason)} ${draft.intakeYear}` },
    { label: strings["answer.education"], value: opt(draft.educationLevel) },
    { label: strings["answer.grade"], value: formatPortalString(strings.gradeOf, { grade: String(draft.averageGrade), scale: draft.gradeScale }) },
    { label: strings["answer.fields"], value: draft.studyFields.map(fieldLabel).join(", ") },
    { label: strings["answer.levels"], value: draft.studyLevels.map(opt).join(", ") },
    { label: strings["answer.nationality"], value: localizedCountryLabel(draft.nationality, locale) },
    { label: strings["answer.english"], value: english },
    { label: strings["answer.budget"], value: opt(draft.tuitionBudget) },
    { label: strings["answer.funding"], value: opt(draft.fundingSource) },
  ];
}

export function ApplicationStatus({ application, draftOwnerId, locale = "ru" }: { application: StudentApplication; draftOwnerId: string; locale?: Locale }) {
  const strings = getPortalStrings("apply", locale);
  const [state, action, pending] = useActionState(refreshStudentApplicationAction, { status: "idle" } as const);
  useEffect(() => {
    try {
      const prefix = `evo-application-draft-v1:${draftOwnerId}:`;
      const obsolete = Object.keys(sessionStorage).filter((key) => key.startsWith(prefix) && Number(key.slice(prefix.length)) < application.revision);
      for (const key of obsolete) sessionStorage.removeItem(key);
      sessionStorage.removeItem("evo-application-draft-v1");
    } catch { /* Storage is optional; the application is persisted on the server. */ }
  }, [draftOwnerId, application.revision]);
  const approved = application.status === "approved";
  const rejected = application.status === "rejected";
  return <>
    <div className="border-b border-border pb-8">
      <p className="text-sm font-medium text-fg-2">{strings.statusKicker}</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight text-fg">{approved ? strings.statusApprovedTitle : rejected ? strings.statusRejectedTitle : strings.statusPendingTitle}</h1>
      <p className="mt-4 max-w-xl text-base leading-7 text-fg-2">{approved ? strings.statusApprovedLead : rejected ? strings.statusRejectedLead : strings.statusPendingLead}</p>
      {application.decisionReason && <p className="mt-4 rounded-ctl bg-surface-2 p-4 text-sm leading-6 text-fg">{application.decisionReason}</p>}
      <div className="mt-6 flex flex-wrap gap-3">
        {rejected ? <Link href="/apply?edit=1" className="inline-flex min-h-12 items-center rounded-ctl bg-accent px-5 font-semibold text-on-accent">{strings.fixApplication}</Link>
          : <form action={action}><button disabled={pending} className="min-h-12 rounded-ctl bg-accent px-5 font-semibold text-on-accent disabled:opacity-60">{pending ? strings.checking : approved ? strings.openCabinet : strings.refreshStatus}</button></form>}
        <form action={logoutStudentPortalAction}><button className="min-h-12 rounded-ctl px-5 font-medium text-fg-2 hover:bg-surface-2">{strings.logout}</button></form>
      </div>
      {state.status !== "idle" && <p role="alert" className="mt-3 text-sm text-danger">{strings.refreshFailed}</p>}
    </div>
    <section className="pt-8" aria-labelledby="application-answers">
      <h2 id="application-answers" className="text-xl font-semibold text-fg">{strings.answersHeading}</h2>
      <p className="mt-2 text-sm text-fg-2">{application.email}</p>
      <dl className="mt-5 grid gap-x-10 sm:grid-cols-2">{localizedAnswers(application.questionnaire, strings, locale).map((item) => <div key={item.label} className="min-w-0 border-b border-border py-4"><dt className="text-sm text-fg-2">{item.label}</dt><dd className="mt-1.5 break-words text-base font-medium text-fg">{item.value}</dd></div>)}</dl>
    </section>
  </>;
}
