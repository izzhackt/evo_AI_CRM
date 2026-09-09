"use client";

import { useEffect, useRef, type ReactNode } from "react";

const TITLE = "Короткий отчёт по направлениям";

/** The sidebar shortcut reveals the report even after its async data arrives. */
export function AdmissionsSummaryReport({
  expanded,
  children,
}: Readonly<{ expanded: boolean; children: ReactNode }>) {
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (expanded) heading.current?.focus();
  }, [expanded]);

  if (expanded) {
    return (
      <section
        id="admissions-summary"
        aria-labelledby="admissions-summary-title"
        className="rounded-card border border-border bg-surface p-4 sm:p-5"
      >
        <h2
          ref={heading}
          id="admissions-summary-title"
          tabIndex={-1}
          className="mb-4 rounded-nav text-base font-semibold text-fg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus-ring"
        >
          {TITLE}
        </h2>
        {children}
      </section>
    );
  }

  return (
    <details className="rounded-card border border-border bg-surface p-4 sm:p-5">
      <summary className="min-h-11 cursor-pointer rounded-nav text-sm font-semibold text-fg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus-ring">
        {TITLE}
      </summary>
      {children}
    </details>
  );
}
