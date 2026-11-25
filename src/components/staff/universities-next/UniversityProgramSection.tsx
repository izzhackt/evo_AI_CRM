import { ExternalLinkIcon } from "lucide-react";

import { KeyFacts } from "@/components/kit";
import { Button } from "@/components/ui/button";

import { UniversityIntakes } from "./UniversityIntakes";
import type { ProgramView } from "./university-detail-types";

export function ExternalButton({ href, children }: Readonly<{ href: string; children: string }>) {
  return (
    <Button variant="ghost" asChild>
      <a href={href} target="_blank" rel="noopener noreferrer">{children}<ExternalLinkIcon aria-hidden="true" /><span className="sr-only"> (в новой вкладке)</span></a>
    </Button>
  );
}

/**
 * Одна программа вуза: название, «Страница программы», уровень, срок и язык, описание и таблица наборов. В свёрнутой группе
 * уровня (`UniversityProgramGroups`: «Программы» `h2` → уровень `h3`) название — `h4`, в коротком списке — `h2`.
 */
export function UniversityProgramSection({ program, heading = "h2" }: Readonly<{ program: ProgramView; heading?: "h2" | "h4" }>) {
  const Heading = heading;
  return (
    <section id={`program-${program.id}`} aria-labelledby={`program-title-${program.id}`} data-program={program.id} className="grid min-w-0 scroll-mt-4 gap-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4">
        <Heading id={`program-title-${program.id}`} className="t-section min-w-0 text-fg">{program.title}</Heading>
        <ExternalButton href={program.sourceUrl}>Страница программы</ExternalButton>
      </div>
      <KeyFacts columns={3} facts={[{ label: "Уровень", value: program.level }, { label: "Длительность", value: program.duration }, { label: "Язык обучения", value: program.language }]} />
      <p className="max-w-[70ch] t-body-compact text-fg-2">{program.summary}</p>
      {program.intakes.length ? <UniversityIntakes title={program.title} intakes={program.intakes} /> : null}
    </section>
  );
}
