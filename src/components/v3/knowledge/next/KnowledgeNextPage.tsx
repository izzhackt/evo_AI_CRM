"use client";

import { PageShell, SectionTabs } from "@/components/kit";

import { KnowledgeNextLibrary } from "./KnowledgeNextLibrary";

const TABS = [
  { key: "library", label: "Материалы", href: "/v3/knowledge" },
  { key: "documents", label: "Документы", href: "/v3/knowledge?section=documents" },
  { key: "snippets", label: "Шаблоны ответов", href: "/v3/knowledge?section=snippets" },
] as const;

/**
 * «База знаний» в новом виде: `PageShell`, вкладки-ссылки разделов (`SectionTabs`: материалы, документы, шаблоны ответов) и содержимое
 * раздела. «Материалы» рисует `KnowledgeNextLibrary`; «Документы» и «Шаблоны ответов» страница читает на сервере и отдаёт как `children`.
 * Права (только администратор) и адреса (`section`, `area`, `folder`, `item`, `view`) прежние.
 */
export function KnowledgeNextPage({ commandScope, section, children }: Readonly<{
  commandScope: string;
  section: "documents" | "snippets" | null;
  children?: React.ReactNode;
}>) {
  return (
    <PageShell
      title="База знаний"
      testId="v3-knowledge-next"
      help="Внутренняя и клиентская база, сырой архив и доступы — в «Материалах»; файлы компании и студентов — в «Документах»; готовые ответы для чатов — в «Шаблонах ответов». Поиск идёт по всей базе."
    >
      <SectionTabs label="Материалы, документы, шаблоны ответов" value={section ?? "library"} tabs={TABS} />
      {section ? children : <KnowledgeNextLibrary commandScope={commandScope} />}
    </PageShell>
  );
}
