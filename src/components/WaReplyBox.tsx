"use client";

import { useRef, useState, useTransition } from "react";
import { PreparedAiDrawer } from "@/components/PreparedAiDrawer";
import type { PreparedAiBundle } from "@/lib/prepared-ai";

type Labels = {
  label: string;
  placeholder: string;
  send: string;
  aiDraft: string;
  aiThinking: string;
  aiNotConfigured: string;
};

export function WaReplyBox({
  conversationId,
  sendAction,
  labels,
  preparedAi,
}: {
  conversationId: number;
  sendAction: (form: FormData) => Promise<void>;
  labels: Labels;
  preparedAi?: PreparedAiBundle;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const replyInputId = `wa-reply-${conversationId}`;

  function insertPreparedReply(text: string) {
    const input = inputRef.current;
    if (input) input.value = text;
    setDrawerOpen(false);
    window.requestAnimationFrame(() => input?.focus());
  }

  return (
    <div className="border-t border-border p-3">
      <form
        aria-busy={isPending}
        action={(form) => {
          startTransition(async () => {
            await sendAction(form);
            if (inputRef.current) inputRef.current.value = "";
          });
        }}
        className="flex items-end gap-2"
      >
        <input type="hidden" name="conversation_id" value={conversationId} />
        <label htmlFor={replyInputId} className="min-w-0 flex-1 text-[12px] font-medium text-fg-2">
          <span className="mb-1 block">{labels.label}</span>
          <input
            id={replyInputId}
            ref={inputRef}
            name="text"
            required
            autoComplete="off"
            placeholder={labels.placeholder}
            className="h-11 w-full rounded-ctl border border-border-strong bg-surface-2 px-3 text-[13.5px] text-fg placeholder:text-fg-3 transition-[border-color,box-shadow] duration-150 focus-visible:border-accent"
          />
        </label>
        {preparedAi && (
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            title={labels.aiDraft}
            aria-label={labels.aiDraft}
            aria-haspopup="dialog"
            aria-expanded={drawerOpen}
            aria-controls="prepared-ai-drawer"
            className="h-11 shrink-0 rounded-ctl border border-border-strong bg-violet-weak px-3 text-[13px] font-semibold text-violet transition hover:brightness-[1.05]"
          >
            AI
          </button>
        )}
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-ctl bg-accent px-4 text-[13.5px] font-semibold text-on-accent transition-[filter,transform] duration-150 hover:brightness-[1.08] active:scale-[0.98]"
        >
          {labels.send}
        </button>
      </form>
      {preparedAi && (
        <PreparedAiDrawer
          bundle={preparedAi}
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          onUseReply={insertPreparedReply}
        />
      )}
    </div>
  );
}
