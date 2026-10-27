"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { QUEUE_CONFIRM } from "@/components/v3/queue/queue-buttons";
import type { PlatformCompanyFileActionState } from "@/lib/platform-company-file-actions";

import { ACTION_MESSAGE, initialActionState, useRefreshAfterMutation } from "../../FileManager";
import { useConfirmStep } from "./useConfirmStep";

type FileAction = (state: PlatformCompanyFileActionState, form: FormData) => Promise<PlatformCompanyFileActionState>;

/** Итог команды словами прежних форм: «сохранено» — спокойно, расхождение — предупреждение, остальное — проблема. */
export function FileFeedback({ state, testId }: Readonly<{ state: PlatformCompanyFileActionState; testId?: string }>) {
  if (state.status === "idle") return null;
  const tone = state.status === "saved" ? "text-ok" : state.status === "invalid" || state.status === "stale" ? "text-warn" : "text-danger";
  return <p role="status" data-testid={testId} data-outcome={state.status} className={`t-body-compact ${tone}`}>{ACTION_MESSAGE[state.status]}</p>;
}

/**
 * Одна команда над папкой или файлом: форма с тем же серверным действием, скрытыми полями (`folder_id` / `company_file_id`,
 * `expected_version`, `request_id`) и итогом, что у прежних форм `FileManager`. После «сохранено» страница обновляется и приносит
 * новые версию и request_id. `confirm` — вопрос перед необратимым («Удалить …»): сначала вопрос, потом кнопка.
 */
export function FileActionForm({ action, requestId, itemKind, itemId, hidden, submit, pending: pendingLabel, confirm, disabled = false, children, testId }: Readonly<{
  action: FileAction;
  requestId: string;
  itemKind: "folder" | "file";
  itemId: string | null;
  hidden: Readonly<Record<string, string>>;
  submit: string;
  pending: string;
  confirm?: string;
  disabled?: boolean;
  children?: React.ReactNode;
  testId?: string;
}>) {
  const [state, run, pending] = useActionState(action, initialActionState(requestId, itemKind, itemId));
  useRefreshAfterMutation(state.status);
  const { asking, questionId, trigger, confirm: confirmButton, ask } = useConfirmStep();
  const locked = pending || state.status === "saved";
  return (
    <form action={run} className="grid gap-3" aria-busy={pending} data-testid={testId}>
      {Object.entries(hidden).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
      <input type="hidden" name="request_id" value={state.requestId} />
      <fieldset disabled={locked} className="grid min-w-0 gap-3 border-0 p-0">{children}</fieldset>
      {confirm && !asking && !pending ? (
        <div><Button ref={trigger} type="button" variant="outline" disabled={disabled || locked} onClick={() => ask(true)}>{submit}</Button></div>
      ) : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {confirm ? <p id={questionId} className="t-body-compact text-fg">{confirm}</p> : null}
          <button ref={confirmButton} type="submit" aria-describedby={confirm ? questionId : undefined} className={QUEUE_CONFIRM} disabled={disabled || locked}>{pending ? pendingLabel : confirm ? "Да, удалить" : submit}</button>
          {confirm ? <Button type="button" variant="ghost" disabled={pending} onClick={() => ask(false)}>Отмена</Button> : null}
        </div>
      )}
      <FileFeedback state={state} />
    </form>
  );
}
