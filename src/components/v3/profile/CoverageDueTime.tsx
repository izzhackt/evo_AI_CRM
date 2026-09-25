import type { CoverageDeadline } from "@/lib/platform-case-coverage-contract";

import { coverageDue } from "./students-coverage-view";

/** Срок замещения моноширинными цифрами — тем же форматом, что колонка «Срок». */
export function CoverageDueTime({ value, today }: Readonly<{ value: CoverageDeadline | null; today: string }>) {
  const due = coverageDue(value, today);
  if (!due) return <>Без срока</>;
  return (
    <>
      <time dateTime={due.dateTime} className="whitespace-nowrap font-mono tabular-nums">{due.text}</time>
      {due.timed ? " · Бишкек" : null}
    </>
  );
}
