import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/components/ui";

type Tab = "documents" | "snippets";

export function KnowledgeWorkspaceTabs({
  documents,
  snippets,
  requestedTab,
}: Readonly<{
  documents: ReactNode | null;
  snippets: ReactNode | null;
  requestedTab: string | null;
}>) {
  const hasBoth = documents !== null && snippets !== null;

  if (!hasBoth) return <>{documents ?? snippets}</>;

  const active: Tab = requestedTab === "snippets" ? "snippets" : "documents";

  return (
    <div>
      <div role="tablist" aria-label="Разделы базы знаний" className="mb-5 flex gap-1 border-b border-border">
        {([
          ["documents", "Документы"],
          ["snippets", "Шаблоны ответов"],
        ] as const).map(([id, label]) => (
          <Link
            key={id}
            role="tab"
            id={`v3-knowledge-tab-${id}`}
            aria-controls={`v3-knowledge-panel-${id}`}
            aria-selected={active === id}
            href={id === "documents" ? "/v3/knowledge" : "/v3/knowledge?tab=snippets"}
            scroll={false}
            className={cn(
              "inline-flex min-h-11 items-center border-b-2 px-3 text-sm font-semibold transition-colors",
              active === id
                ? "border-accent text-fg"
                : "border-transparent text-fg-3 hover:text-fg",
            )}
          >
            {label}
          </Link>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`v3-knowledge-panel-${active}`}
        aria-labelledby={`v3-knowledge-tab-${active}`}
      >
        {active === "documents" ? documents : snippets}
      </div>
    </div>
  );
}
