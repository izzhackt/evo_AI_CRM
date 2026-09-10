import Link from "next/link";
import { readStudentPortalAssessmentPreview } from "@/lib/server/student-portal-assessment-preview";
import { PortalPage } from "../PortalPage";
import { AssessmentPreviewRunner } from "./AssessmentPreviewRunner";

export async function PortalAssessmentPreviewList() {
  const instruments = await Promise.all([readStudentPortalAssessmentPreview("english"), readStudentPortalAssessmentPreview("career")]);
  return <PortalPage title="Тесты" description="Английский и профессиональные интересы — внутри кабинета студента.">
    <p className="max-w-3xl text-sm leading-6 text-fg-2">Здесь можно посмотреть действующие вопросы и инструкции. Личные попытки, ответы и результаты студентов не загружаются.</p>
    <div className="mt-6 grid max-w-4xl gap-5 md:grid-cols-2">{instruments.map(instrument => <section key={instrument.instrumentKey} className="flex flex-col rounded-card border border-border bg-surface p-5 sm:p-6">
      <h2 className="text-xl font-semibold text-fg">{instrument.title}</h2>
      <p className="mt-3 text-sm leading-6 text-fg-2">{instrument.description}</p>
      <p className="mt-4 text-sm text-fg-3">{instrument.questions.length} заданий · версия {instrument.version}</p>
      <Link href={`/preview/student/tests/${instrument.instrumentKey === "english36" ? "english" : "career"}`} aria-label={`Просмотреть: ${instrument.title}`} className="mt-6 inline-flex min-h-11 items-center justify-center self-start rounded-nav bg-accent px-5 py-2 text-sm font-medium text-on-accent hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring">Посмотреть вопросы</Link>
    </section>)}</div>
  </PortalPage>;
}

export async function PortalAssessmentPreviewPage({ kind }: { kind: "english" | "career" }) {
  const content = await readStudentPortalAssessmentPreview(kind);
  return <PortalPage title={content.title} description={content.description}>
    <AssessmentPreviewRunner key={`${content.instrumentKey}-${content.version}`} content={content} />
  </PortalPage>;
}
