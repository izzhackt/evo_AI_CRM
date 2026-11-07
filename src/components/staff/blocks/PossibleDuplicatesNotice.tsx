import Link from "next/link";

import { Button } from "@/components/ui/button";
import type { PossibleDuplicate } from "@/lib/v3/possible-duplicates";

/**
 * «Похоже, этот студент уже есть в CRM» (07.11.2026): похожие дела и лиды ссылками до создания нового студента —
 * предупреждение на виду, решение за сотрудником. Общий для «Настройки → Кабинеты студентов» и одобрения анкеты.
 */
export function PossibleDuplicatesNotice({ matches, hint, confirmLabel, pending, onConfirm }: Readonly<{
  matches: readonly PossibleDuplicate[];
  hint: string;
  confirmLabel: string;
  pending: boolean;
  onConfirm: () => void;
}>) {
  return (
    <div role="alert" className="grid gap-2 border-t border-border pt-3" data-testid="possible-duplicates">
      <p className="t-body-compact font-semibold text-danger">Похоже, этот студент уже есть в CRM</p>
      <ul className="grid gap-1">
        {matches.map((match) => (
          <li key={`${match.kind}:${match.id}`} className="t-body-compact min-w-0 break-words text-fg">
            <Link href={match.href} className="underline underline-offset-4 hover:text-fg-2">{match.label}</Link>
            <span className="text-fg-2"> · {match.kind === "case" ? "дело" : "лид"}{match.meta ? ` · ${match.meta}` : ""}</span>
          </li>
        ))}
      </ul>
      <p className="t-meta text-fg-2">{hint}</p>
      <div>
        <Button type="button" variant="outline" disabled={pending} onClick={onConfirm}>{confirmLabel}</Button>
      </div>
    </div>
  );
}
