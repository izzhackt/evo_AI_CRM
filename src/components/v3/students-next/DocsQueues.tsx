"use client";

import Link from "next/link";
import { useState } from "react";

import { EmptyState } from "@/components/kit";
import { Button } from "@/components/ui/button";
import type { ApplicationDocumentOwner } from "@/lib/portal/application-documents";

import { PackagesRecovery, ProgramDocsRecovery } from "../students/DocsQueueRecovery";
import { docsOldestFirst, russianPlural, type DocsPackagesRead, type DocsProgramRead } from "../students/students-queue-view";
import { DocsPackagesTable } from "./DocsPackagesTable";
import { DocsProgramTable } from "./DocsProgramTable";

/** Единственная строка о неполном чтении очереди (под таблицей): «последние» уже говорит, что сверху новые. */
function QueueRest({ shown, words }: Readonly<{ shown: number; words: readonly [string, string, string] }>) {
  return (
    <p role="status" className="t-body-compact text-fg-2">
      Показаны последние {shown} {russianPlural(shown, ...words)}: очередь длиннее — после проверки появятся остальные.
    </p>
  );
}

function Unavailable({ text, retryHref }: Readonly<{ text: string; retryHref?: string }>) {
  return (
    <div role={retryHref ? "alert" : "status"} className="rounded-card border border-border bg-surface">
      <EmptyState tone={retryHref ? "danger" : "neutral"} title={text} action={retryHref ? <Button variant="outline" asChild><Link href={retryHref}>Повторить</Link></Button> : undefined} />
    </div>
  );
}

/** «Документы программ»: решение по файлу — в панели строки; незавершённые решения (хранит браузер) — над таблицей и при пустой очереди. */
export function ProgramQueue({ program, review, returnTo, today, empty }: Readonly<{
  program: DocsProgramRead;
  review: Readonly<{ owner: ApplicationDocumentOwner; canReview: boolean }> | undefined;
  returnTo: string;
  today: string;
  empty: React.ReactNode;
}>) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (program.kind === "error") return <Unavailable text="Не удалось загрузить документы программ на проверку." retryHref={returnTo} />;
  if (program.kind !== "ready" || !review) return <Unavailable text="Очередь документов программ вашей учётной записи недоступна" />;
  const { nextCursor } = program.queue;
  const { items } = docsOldestFirst(program.queue.items, (item) => item.submission.submittedAt, (item) => item.submission.submissionId, nextCursor === null);
  return (
    <>
      <ProgramDocsRecovery owner={review.owner} visibleSubmissions={openId ? [openId] : []} />
      <DocsProgramTable items={items} owner={review.owner} canReview={review.canReview} today={today} returnTo={returnTo} empty={empty} onOpenId={setOpenId} />
      {nextCursor ? <QueueRest shown={items.length} words={["документ", "документа", "документов"]} /> : null}
    </>
  );
}

/** «Комплекты»: отправленные на проверку EVO и ещё без решения; незавершённые решения — над таблицей и при пустой очереди. */
export function PackagesQueue({ packages, owner, returnTo, today, empty }: Readonly<{
  packages: DocsPackagesRead;
  owner: ApplicationDocumentOwner | null;
  returnTo: string;
  today: string;
  empty: React.ReactNode;
}>) {
  if (packages.kind === "error") return <Unavailable text="Не удалось загрузить комплекты на проверку." retryHref={returnTo} />;
  if (packages.kind !== "ready") return <Unavailable text="Очередь комплектов вашей учётной записи недоступна" />;
  const { nextCursor } = packages.queue;
  const { items } = docsOldestFirst(packages.queue.items, (item) => item.package.submittedAt, (item) => item.package.packageId, nextCursor === null);
  return (
    <>
      {owner ? <PackagesRecovery owner={owner} /> : null}
      <DocsPackagesTable items={items} today={today} returnTo={returnTo} empty={empty} />
      {nextCursor ? <QueueRest shown={items.length} words={["комплект", "комплекта", "комплектов"]} /> : null}
    </>
  );
}
