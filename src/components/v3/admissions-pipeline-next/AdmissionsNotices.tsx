import Link from "next/link";
import type { RefObject } from "react";

import { Button } from "@/components/ui/button";
import { removalMessage, type BoardError, type CrossTabHint, type RemovalNotice } from "@/components/v3/admissions-board/board-model";
import { cn } from "@/lib/utils";
import type { AdmissionsPipelineTab } from "@/lib/platform-admissions-pipeline-contract";
import { admissionsPipelineTab } from "@/lib/v3/wording";

const TEXT = "t-body-compact min-w-0 flex-[1_1_16rem] break-words py-2 text-fg";

function CrossTabLink({ hint, tabHref }: Readonly<{ hint: CrossTabHint; tabHref: (tab: AdmissionsPipelineTab) => string }>) {
  return (
    <Link href={tabHref(hint.tab)} prefetch={false} className="t-item inline-flex min-h-11 items-center px-1 text-accent-text underline underline-offset-4">
      Открыть в «{admissionsPipelineTab(hint.tab)}»
    </Link>
  );
}

/**
 * Строки уведомлений доски поступления нового вида — те же слова и роли, что у прежней: одна красная строка отказа (причина, где
 * дело сейчас, ссылка в другой раздел), строка «убрано из воронки» с «Вернуть» и строка перемещения (переход в другой раздел,
 * итог «Отменить»). Строки и их вежливые живые области держат ссылки `errorRef` и `noticeRef`: на них возвращается фокус.
 */
export function AdmissionsNotices({ error, errorRef, noticeRef, removal, moveShown, moveText, crossTabHint, undoNote, tabHref, onRestore }: Readonly<{
  error: BoardError | null;
  errorRef: RefObject<HTMLDivElement | null>;
  noticeRef: RefObject<HTMLDivElement | null>;
  removal: RemovalNotice | null;
  moveShown: boolean;
  moveText: string | null;
  crossTabHint: CrossTabHint | null;
  undoNote: string | null;
  tabHref: (tab: AdmissionsPipelineTab) => string;
  onRestore: (notice: RemovalNotice) => void;
}>) {
  return (
    <>
      {error ? (
        <div ref={errorRef} tabIndex={-1} role="alert" className="mb-3 flex flex-wrap items-center gap-x-3 rounded-card border border-danger bg-danger-weak px-4 outline-none">
          <p className="t-body-compact min-w-0 flex-[1_1_16rem] break-words py-2 text-danger">{error.where ? `${error.message} ${error.where}` : error.message}</p>
          {error.hint ? <CrossTabLink hint={error.hint} tabHref={tabHref} /> : null}
        </div>
      ) : null}
      <div ref={noticeRef} tabIndex={-1}
        className={cn("outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring", (removal || moveShown) && "mb-3 flex flex-col rounded-card border border-border bg-card px-4 py-1")}>
        <div className={removal ? "flex flex-wrap items-center gap-x-3" : undefined}>
          <p role="status" className={removal ? TEXT : undefined}>{removal ? removalMessage(removal) : null}</p>
          {removal?.phase === "removed" ? <Button variant="ghost" onClick={() => onRestore(removal)}>Вернуть в воронку</Button> : null}
        </div>
        <div className={moveShown ? "flex flex-wrap items-center gap-x-3" : undefined}>
          <p role="status" className={moveShown ? TEXT : moveText ? "sr-only" : undefined}>{moveText}</p>
          {crossTabHint && !undoNote ? <CrossTabLink hint={crossTabHint} tabHref={tabHref} /> : null}
        </div>
      </div>
    </>
  );
}
