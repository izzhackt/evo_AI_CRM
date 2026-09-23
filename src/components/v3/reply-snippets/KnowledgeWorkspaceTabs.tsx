import Link from "next/link";
import type { ReactNode } from "react";

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
      <nav
        aria-label="Разделы базы знаний"
        className="mb-5 border-b border-border pb-2"
      >
        <ul className="flex gap-1">
          {([
            ["documents", "Документы"],
            ["snippets", "Шаблоны ответов"],
          ] as const).map(([id, label]) => (
            <li key={id}>
              <Link
                aria-current={active === id ? "page" : undefined}
                href={id === "documents" ? "/v3/knowledge" : "/v3/knowledge?tab=snippets"}
                scroll={false}
                className="v3-choice inline-flex min-h-11 items-center rounded-nav px-3 text-sm font-semibold text-fg-2 transition-colors hover:bg-surface-2 hover:text-fg"
              >
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div>{active === "documents" ? documents : snippets}</div>
    </div>
  );
}
